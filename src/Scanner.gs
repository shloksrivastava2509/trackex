/**
 * Main loop — runs on a time trigger. Finds candidate Gmail threads, extracts data
 * from any messages not yet processed, and updates the sheet + calendar.
 */
function scanInbox() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 'Another scan is already running.';
  const started = Date.now();
  const outOfTime = () => Date.now() - started > CONFIG.MAX_RUNTIME_MS;

  try {
    const store = new Store();
    const backfillDone = prop_('BACKFILL_DONE') === 'true';
    const days = backfillDone ? CONFIG.INCREMENTAL_LOOKBACK_DAYS : CONFIG.INITIAL_LOOKBACK_DAYS;
    const query = `newer_than:${days}d ${CONFIG.EXCLUDE_QUERY} {${CONFIG.SEARCH_TERMS.join(' ')}}`;
    const label = GmailApp.getUserLabelByName(CONFIG.TRACKED_LABEL) || GmailApp.createLabel(CONFIG.TRACKED_LABEL);
    const useClaude = !!prop_('ANTHROPIC_API_KEY');

    let processedThreads = 0, newEvents = 0, exhausted = true;
    const appsBefore = store.apps.rows.length;

    pages:
    for (let start = 0; ; start += CONFIG.PAGE_SIZE) {
      const threads = GmailApp.search(query, start, CONFIG.PAGE_SIZE);
      if (!threads.length) break;

      // One batched call for every message in the page, instead of two calls per thread.
      const messagesByThread = GmailApp.getMessagesForThreads(threads);
      const work = [];
      threads.forEach((thread, i) => {
        const threadId = thread.getId();
        const since = store.lastProcessedMs(threadId);
        // Only the newest few unseen messages; older ones in a long thread are stale.
        const fresh = messagesByThread[i].filter(m => m.getDate().getTime() > since).slice(-3);
        if (fresh.length) work.push({ thread, threadId, fresh });
      });

      for (let b = 0; b < work.length; b += CONFIG.EXTRACT_BATCH) {
        if (outOfTime() || processedThreads >= CONFIG.MAX_THREADS_PER_RUN) { exhausted = false; break pages; }
        const batch = work.slice(b, b + CONFIG.EXTRACT_BATCH);
        const items = batch.flatMap(w => w.fresh.map(message => ({ w, message, email: toEmail_(message, w.threadId) })));
        const results = extractAll_(items.map(it => it.email), useClaude);

        const relevant = new Set();
        items.forEach(({ w, message, email }, i) => {
          const data = results[i];
          if (data.category === 'job_application' && data.application.company) {
            store.upsertApplication(data.application, email);
            relevant.add(w.threadId);
          }
          for (const ev of data.events || []) {
            if (addEventToCalendar_(ev, email, store)) newEvents++;
            relevant.add(w.threadId);
          }
          store.markProcessed(w.threadId, message.getDate().getTime());
        });
        batch.filter(w => relevant.has(w.threadId)).forEach(w => w.thread.addLabel(label));
        processedThreads += batch.length;
        store.flush();  // checkpoint after every batch
      }
    }

    const merged = store.mergeDuplicateApplications();
    store.flush();
    const newApps = store.apps.rows.length - appsBefore;
    if (!backfillDone && exhausted) setProp_('BACKFILL_DONE', 'true');
    setProp_('LAST_SCAN', new Date().toISOString());

    const summary = `Scanned ${processedThreads} thread(s): ${newApps >= 0 ? '+' : ''}${newApps} application(s), +${newEvents} calendar event(s)` +
      (merged ? `, merged ${merged} duplicate(s)` : '') +
      (exhausted ? '' : ' — more remaining, will continue next run') +
      (useClaude ? '' : ' [heuristic mode: set ANTHROPIC_API_KEY for better extraction]');
    console.log(summary);
    return summary;
  } finally {
    lock.releaseLock();
  }
}

/** Claude (in parallel) with heuristic fallback, then the tracking-link safety net. */
function extractAll_(emails, useClaude) {
  const fromClaude = useClaude ? extractManyWithClaude_(emails) : emails.map(() => null);
  return emails.map((email, i) => refinePortal_(fromClaude[i] || extractWithHeuristics_(email), email));
}

/**
 * Keeps the portal link honest: it must be a link that is really in the email, and an
 * explicit "track your application" link found by the scorer beats anything weaker.
 */
function refinePortal_(data, email) {
  const app = data.application;
  if (data.category !== 'job_application' || !app) return data;
  const inEmail = new Set(email.links.map(l => l.url));
  if (app.portal_url && !inEmail.has(app.portal_url)) { app.portal_url = ''; app.portal_kind = ''; }
  const pick = pickPortalLink_(email.links);
  if (pick.url && portalRank_(pick.url, pick.kind) > portalRank_(app.portal_url, app.portal_kind)) {
    Object.assign(app, portalFields_(pick));
  }
  return data;
}

function toEmail_(message, threadId) {
  const html = message.getBody() || '';
  let body = message.getPlainBody() || '';
  if (!body.trim()) body = htmlToText_(html);
  return {
    from: message.getFrom(),
    subject: message.getSubject() || '(no subject)',
    date: message.getDate(),
    body: body.replace(/\n{3,}/g, '\n\n'),
    links: extractLinks_(html),
    emailLink: CONFIG.GMAIL_THREAD_URL + threadId
  };
}

function extractLinks_(html) {
  const links = [];
  const seen = new Set();
  const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1].replace(/&amp;/g, '&').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    // The sentence before the link, so "To track your application, click here" is understood.
    const context = htmlToText_(html.slice(Math.max(0, m.index - 600), m.index)).replace(/\s+/g, ' ').trim().slice(-140);
    links.push({ url, text: htmlToText_(m[2]).replace(/\s+/g, ' ').trim().slice(0, 80), context });
  }
  return links;
}

function htmlToText_(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ');
}
