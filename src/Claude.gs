/**
 * Email → structured data using Claude (Messages API over UrlFetchApp — Apps Script
 * has no SDK). Returns null when no key is configured or the call fails, so the
 * caller falls back to heuristics.
 */
// A function, not a const: Apps Script may load Claude.gs before Config.gs (STATUSES).
function extractionSchema_() { return {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'application', 'events'],
  properties: {
    category: { type: 'string', enum: ['job_application', 'hackathon_or_event', 'other'] },
    application: {
      type: 'object',
      additionalProperties: false,
      required: ['company', 'role', 'kind', 'status', 'portal_url', 'portal_kind'],
      properties: {
        company: { type: 'string' },
        role: { type: 'string' },
        kind: { type: 'string', enum: ['Job', 'Internship', 'Fellowship', 'Program', 'Other', ''] },
        status: { type: 'string', enum: STATUSES.concat(['']) },
        portal_url: { type: 'string' },
        portal_kind: { type: 'string', enum: ['application_status', 'careers_portal', 'job_posting', ''] }
      }
    },
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'organization', 'kind', 'start_iso', 'end_iso', 'all_day', 'url'],
        properties: {
          title: { type: 'string' },
          organization: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['registration_deadline', 'submission_deadline', 'application_deadline',
              'event_start', 'event_end', 'interview', 'assessment_due', 'other']
          },
          start_iso: { type: 'string' },
          end_iso: { type: 'string' },
          all_day: { type: 'boolean' },
          url: { type: 'string' }
        }
      }
    }
  }
}; }

const EXTRACTION_SYSTEM = `You read one email from a student's inbox and extract two things: job/internship application tracking data, and dated deadlines worth putting on their calendar.

category:
- "job_application": the email is about an application the user has ALREADY submitted or is progressing through (confirmation, under review, online assessment, interview invite/scheduling, offer, rejection, withdrawal). Job alerts, recommended jobs, recruiter cold outreach about roles they did not apply to, and newsletters are "other".
- "hackathon_or_event": hackathons, coding competitions, buildathons, fellowships/programs with application deadlines, career fairs or info sessions with a registration deadline.
- "other": everything else. Return empty application fields and no events.

application (fill only for job_application, otherwise all empty strings):
- company: the hiring organization, not the ATS vendor (an email from Greenhouse on behalf of Stripe → "Stripe").
- role: exact role title if stated, else "".
- status: the stage this email signals.
- portal_url: copy EXACTLY one URL from the provided link list, in this order of preference:
  1. the link the email offers for tracking or checking THIS application ("track your application", "view your application status", "check your candidate portal"). Its text is often just "click here" or "here" — use the context shown before the link;
  2. a candidate-portal / sign-in link where the user can see their applications;
  3. the company's careers site;
  4. "".
  Never invent URLs; never pick unsubscribe, privacy, social-media, job-alert or "similar jobs" links.
- portal_kind: "application_status" for 1 or 2, "careers_portal" for 3, "job_posting" if it is only the posting, else "".

events: every concrete future date the user may need to act on — registration/submission/application deadlines, hackathon start/end, interview slots, assessment due dates. Skip dates with no action attached.
- start_iso/end_iso: ISO 8601 with UTC offset. Resolve relative dates ("this Friday", "within 7 days") against the email's sent date. Assume the user's timezone (given below) unless the email names another timezone.
- For a deadline, put the deadline moment in start_iso and leave end_iso "".
- all_day: true when no time of day is given.
- title: short and specific, e.g. "HackMIT — project submission deadline".
- url: the most relevant link from the list (registration/submission page), else "".`;

function claudeRequest_(email, apiKey) {
  const links = email.links.slice(0, CONFIG.CLAUDE_MAX_LINKS).map(l =>
    `- [${l.text || 'no text'}] → ${l.url}${l.context ? `   (text before link: "…${l.context}")` : ''}`);
  const userContent = [
    `User timezone: ${userTimeZone_()}`,
    `Sent: ${email.date.toISOString()}`,
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    '',
    'Links in the email:',
    links.join('\n') || '(none)',
    '',
    'Body:',
    email.body.slice(0, CONFIG.CLAUDE_MAX_BODY_CHARS)
  ].join('\n');

  return {
    url: 'https://api.anthropic.com/v1/messages',
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 8000,
      fallbacks: 'default',
      output_config: {
        effort: CONFIG.CLAUDE_EFFORT,
        format: { type: 'json_schema', schema: extractionSchema_() }
      },
      system: EXTRACTION_SYSTEM,
      messages: [{ role: 'user', content: userContent }]
    })
  };
}

/** Pure: one HTTP response → {data} (null data = give up, use heuristics) or {retry: true}. */
function parseClaudeResponse_(code, text, subject) {
  if (code === 429 || code >= 500) return { retry: true };
  if (code !== 200) {                         // 400/401/403/404: config problem, don't retry
    console.error(`Claude API ${code}: ${String(text).slice(0, 500)}`);
    return { data: null };
  }
  const msg = JSON.parse(text);
  if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') {
    console.warn(`Claude stop_reason=${msg.stop_reason} for "${subject}"`);
    return { data: null };
  }
  const out = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  try {
    return { data: JSON.parse(out) };
  } catch {
    console.error(`Unparseable Claude output for "${subject}": ${out.slice(0, 300)}`);
    return { data: null };
  }
}

/**
 * Extracts many emails concurrently with UrlFetchApp.fetchAll — one round trip per batch
 * instead of one per email. Returns an array aligned with `emails`; null entries mean
 * "fall back to heuristics". Rate-limited/5xx requests are retried together.
 */
function extractManyWithClaude_(emails) {
  const apiKey = prop_('ANTHROPIC_API_KEY');
  const results = emails.map(() => null);
  if (!apiKey || !emails.length) return results;

  let pending = emails.map((_, i) => i);
  for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
    if (attempt) Utilities.sleep(2000 * attempt);
    const responses = UrlFetchApp.fetchAll(pending.map(i => claudeRequest_(emails[i], apiKey)));
    const retry = [];
    responses.forEach((res, k) => {
      const i = pending[k];
      const r = parseClaudeResponse_(res.getResponseCode(), res.getContentText(), emails[i].subject);
      if (r.retry) retry.push(i); else results[i] = r.data;
    });
    pending = retry;
  }
  if (pending.length) console.error(`Claude API: retries exhausted for ${pending.length} email(s)`);
  return results;
}
