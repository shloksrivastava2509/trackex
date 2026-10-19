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

    let processedThreads = 0, newApps = 0, newEvents = 0, exhausted = true;
    const appsBefore = store.apps.rows.length;

    pages:
    for (let start = 0; ; start += 100) {
      const threads = GmailApp.search(query, start, 100);
      if (!threads.length) break;
      for (const thread of threads) {
        if (outOfTime() || processedThreads >= CONFIG.MAX_THREADS_PER_RUN) { exhausted = false; break pages; }
        const threadId = thread.getId();
        const since = store.lastProcessedMs(threadId);
        if (thread.getLastMessageDate().getTime() <= since) continue;  // nothing new — cheap skip

        // Only the newest few unseen messages; older ones in a long thread are stale.
        const fresh = thread.getMessages().filter(m => m.getDate().getTime() > since).slice(-3);
        let relevant = false;
        for (const message of fresh) {
          const email = toEmail_(message, threadId);
          const data = (useClaude && extractWithClaude_(email)) || extractWithHeuristics_(email);
          if (data.category === 'job_application' && data.application.company) {
            store.upsertApplication(data.application, email);
            relevant = true;
          }
          for (const ev of data.events || []) {
            if (addEventToCalendar_(ev, email, store)) newEvents++;
            relevant = true;
          }
          store.markProcessed(threadId, message.getDate().getTime());
        }
        if (relevant) thread.addLabel(label);
        processedThreads++;
        if (processedThreads % 15 === 0) store.flush();  // checkpoint progress
      }
    }

    store.flush();
    newApps = store.apps.rows.length - appsBefore;
    if (!backfillDone && exhausted) setProp_('BACKFILL_DONE', 'true');
    setProp_('LAST_SCAN', new Date().toISOString());

    const summary = `Scanned ${processedThreads} thread(s): +${newApps} application(s), +${newEvents} calendar event(s)` +
      (exhausted ? '' : ' — more remaining, will continue next run') +
      (useClaude ? '' : ' [heuristic mode: set ANTHROPIC_API_KEY for better extraction]');
    console.log(summary);
    return summary;
  } finally {
    lock.releaseLock();
  }
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
    links.push({ url, text: htmlToText_(m[2]).replace(/\s+/g, ' ').trim().slice(0, 80) });
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
