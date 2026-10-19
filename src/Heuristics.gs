/**
 * Keyword-based fallback extractor, used when no Claude key is set or a call fails.
 * Returns the same shape as extractWithClaude_. Good at status, weak at dates.
 */
const STATUS_RULES = [
  ['Offer', /(pleased to (extend|offer)|offer letter|extend (you )?an offer|congratulations[^.]{0,80}\boffer\b)/i],
  ['Rejected', /(unfortunately|regret to inform|not (be )?moving forward|decided (not )?to (move|proceed)[^.]{0,40}other|not been selected|were not selected|position has been filled|will not be proceeding|pursue other candidates)/i],
  ['Withdrawn', /(application (has been )?withdrawn|you('ve| have) withdrawn)/i],
  ['Interview', /(invite you to (an? )?interview|interview (invitation|invite|schedul)|schedule (an? )?(interview|call|chat)|phone screen|your availability|book a time)/i],
  ['Assessment', /(online assessment|coding (challenge|assessment|test)|hackerrank|codesignal|codility|take[- ]home|technical assessment|complete the assessment)/i],
  ['Applied', /(thank(s| you) for (applying|your application|submitting)|application (has been |was )?(received|submitted)|we('ve| have) received your application|successfully (applied|submitted))/i],
  ['Under Review', /(application is (under|being) review|currently reviewing your application|still reviewing)/i]
];

const EVENT_RE = /(hackathon|\bhack(?!errank|erearth|er\b)|devpost|devfolio|unstop|\bmlh\b|buildathon|ideathon|codeathon|game jam|coding (contest|competition)|fellowship|career fair)/i;
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE_RES = [
  new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?,?\\s*(\\d{4})?(?:[^\\n.]{0,15}?(\\d{1,2}(?::\\d{2})?\\s*[ap]\\.?m\\.?))?`, 'ig'),
  new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})\\.?,?\\s*(\\d{4})?(?:[^\\n.]{0,15}?(\\d{1,2}(?::\\d{2})?\\s*[ap]\\.?m\\.?))?`, 'ig')
];
const DEADLINE_WORDS = /(deadline|due|closes?|closing|last date|submit|submission|register|registration|apply by|ends?|starts?|begins?|kick[- ]?off)/i;

function extractWithHeuristics_(email) {
  const text = `${email.subject}\n${email.body}`;
  const result = {
    category: 'other',
    application: { company: '', role: '', kind: '', status: '', portal_url: '' },
    events: []
  };

  const isEvent = EVENT_RE.test(`${email.from}\n${text}`);
  const rule = STATUS_RULES.find(([, re]) => re.test(text));
  if (rule && !EVENT_RE.test(`${email.from}\n${email.subject}`)) {
    const company = guessCompany_(email);
    const role = guessRole_(email.subject) || guessRole_(email.body.slice(0, 1500));
    result.category = 'job_application';
    result.application = {
      company,
      role: norm_(role) === norm_(company) ? '' : role,
      kind: /intern/i.test(text) ? 'Internship' : 'Job',
      status: rule[0],
      portal_url: pickPortalLink_(email.links)
    };
  }

  if (isEvent || result.category === 'job_application') {
    result.events = findDatedSentences_(email).map(({ date, allDay, sentence }) => ({
      title: `${email.subject.slice(0, 80)} — ${sentence.match(DEADLINE_WORDS)[0].toLowerCase()}`,
      organization: guessCompany_(email),
      kind: /start|begin|kick/i.test(sentence) ? 'event_start' : 'submission_deadline',
      start_iso: date.toISOString(),
      end_iso: '',
      all_day: allDay,
      url: pickPortalLink_(email.links)
    }));
    if (result.category === 'other' && result.events.length) result.category = 'hackathon_or_event';
  }
  return result;
}

function findDatedSentences_(email) {
  const out = [];
  const seen = new Set();
  const sentences = email.body.split(/(?<=[.!?\n])\s+/).filter(s => DEADLINE_WORDS.test(s));
  for (const sentence of sentences.slice(0, 40)) {
    for (const re of DATE_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(sentence))) {
        const monthFirst = isNaN(Number(m[1]));
        const month = monthFirst ? m[1] : m[2];
        const day = monthFirst ? m[2] : m[1];
        const year = m[3] || email.date.getFullYear();
        const time = m[4] ? m[4].replace(/\./g, '').replace(/([ap]m)/i, ' $1') : '';
        const date = new Date(`${month} ${day}, ${year} ${time}`.trim());
        if (isNaN(date)) continue;
        if (!time) date.setHours(12);  // noon: an all-day date stays on the same day in any timezone
        if (!m[3] && date < email.date) date.setFullYear(date.getFullYear() + 1); // "Jan 5" sent in Dec
        const key = date.toISOString();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ date, allDay: !time, sentence });
      }
    }
  }
  return out.slice(0, 5);
}

function guessCompany_(email) {
  const display = (email.from.match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || '';
  const cleaned = display
    .replace(/\b(via|from)\b.*$/i, '')
    .replace(/\b(careers?|recruiting|recruitment|talent( acquisition)?|hiring|jobs?|team|hr|people|university|campus|no-?reply|notifications?)\b/ig, '')
    .replace(/[@|•–-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const domain = ((email.from.match(/@([\w.-]+)/) || [])[1] || '').toLowerCase();
  const domainIsAts = isAtsUrl_(domain) || /(mail|notify|email|noreply)\./.test(domain);
  if (cleaned && (domainIsAts || cleaned.length > 1)) return cleaned;
  const parts = domain.split('.');
  const base = parts.length >= 2 ? parts[parts.length - 2] : domain;
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : '';
}

function guessRole_(text) {
  const m = text.match(/(?:application for|applying for|applied for|position:|role:)\s*(?:the\s+)?([^|–\-:,(.\n]{3,70}?)(?:\s+(?:position|role|opening|at|@)\b|[|–\-:,(.\n]|$)/i) ||
    text.match(/\bthe\s+([A-Z][\w/&+ ]{2,60}?)\s+(?:position|role|opening)\b/);
  return m ? m[1].trim() : '';
}

function pickPortalLink_(links) {
  let best = '', bestScore = 0;
  for (const { text, url } of links) {
    const u = url.toLowerCase(), t = (text || '').toLowerCase();
    if (/unsubscribe|privacy|preferences|terms|mailto:|facebook|twitter|instagram|linkedin\.com\/(company|in)\//.test(u + ' ' + t)) continue;
    let score = 0;
    if (isAtsUrl_(u)) score += 3;
    if (/status|portal|candidate|dashboard|view (your )?application|track|sign ?in|log ?in|my application|register|submit/.test(t)) score += 2;
    if (/job|career|apply|application/.test(u)) score += 1;
    if (score > bestScore) { best = url; bestScore = score; }
  }
  return best;
}
