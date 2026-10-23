/**
 * Keyword-based fallback extractor, used when no Claude key is set or a call fails.
 * Good at status, weak at dates. Dates are emitted as naive local strings.
 */
import type { Email, EmailLink, Extraction, ExtractedEvent, PortalKind, Status } from '@/lib/types';

export const ATS_DOMAINS: string[] = [
  'greenhouse.io', 'lever.co', 'myworkdayjobs.com', 'workday.com', 'icims.com',
  'smartrecruiters.com', 'ashbyhq.com', 'jobvite.com', 'taleo.net', 'successfactors',
  'oraclecloud.com', 'brassring.com', 'workable.com', 'bamboohr.com', 'recruitee.com',
  'joinhandshake.com', 'linkedin.com/jobs', 'wellfound.com', 'eightfold.ai',
  'hackerrank.com', 'codesignal.com', 'codility.com', 'devpost.com', 'mlh.io',
  'unstop.com', 'hackerearth.com', 'devfolio.co'
];

export function isAtsUrl(url: string): boolean {
  return ATS_DOMAINS.some(d => String(url).toLowerCase().includes(d));
}

/** Company-name normaliser used to compare company and role (not the matcher's companyKey). */
export function norm(s: string): string {
  return String(s || '').toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|technologies|labs|pvt|private|limited)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

export const STATUS_RULES: [Status, RegExp][] = [
  ['Offer', /(pleased to (extend|offer)|offer letter|extend (you )?an offer|congratulations[^.]{0,80}\boffer\b)/i],
  ['Rejected', new RegExp([
    'unfortunately', 'regret to (inform|let you know|share)', 'not (be )?(moving|move) forward', "won'?t be (moving|proceeding)",
    'will not be (moving|proceeding|progressing|advancing)', 'unable to (move|proceed|progress|offer you)',
    '(decided|chosen|elected|opted) (not )?to (move|proceed|go|continue|progress)[^.]{0,60}(other|another|different)',
    'not (been )?selected', 'position has been filled', '(pursue|move forward with|proceed with|progress with) other (candidates|applicants)',
    'not (a|the right) (fit|match)', 'no longer (being )?considered', 'not be proceeding', 'after careful (consideration|review)[^.]{0,160}(not|other|unable)'
  ].join('|'), 'i')],
  ['Withdrawn', /(application (has been )?withdrawn|you('ve| have) withdrawn)/i],
  ['Interview', /(invite you to (an? )?interview|interview (invitation|invite|schedul)|schedule (an? )?(interview|call|chat)|phone screen|your availability|book a time)/i],
  ['Assessment', /(online assessment|coding (challenge|assessment|test)|hackerrank|codesignal|codility|take[- ]home|technical assessment|complete the assessment)/i],
  ['Applied', /(thank(s| you) for (applying|your application|submitting)|application (has been |was )?(received|submitted)|we('ve| have) received your application|successfully (applied|submitted))/i],
  ['Under Review', /(application is (under|being) review|currently reviewing your application|still reviewing)/i]
];

export const EVENT_RE = /(hackathon|\bhack(?!errank|erearth|er\b)|devpost|devfolio|unstop|\bmlh\b|buildathon|ideathon|codeathon|game jam|coding (contest|competition)|fellowship|career fair)/i;
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};
const dateRes = (): RegExp[] => [
  new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?,?\\s*(\\d{4})?(?:[^\\n.]{0,15}?(\\d{1,2}(?::\\d{2})?\\s*[ap]\\.?m\\.?))?`, 'ig'),
  new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})\\.?,?\\s*(\\d{4})?(?:[^\\n.]{0,15}?(\\d{1,2}(?::\\d{2})?\\s*[ap]\\.?m\\.?))?`, 'ig')
];
export const DEADLINE_WORDS = /(deadline|due|closes?|closing|last date|submit|submission|register|registration|apply by|ends?|starts?|begins?|kick[- ]?off)/i;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function extractWithHeuristics(email: Email): Extraction {
  const text = `${email.subject}\n${email.body}`;
  const result: Extraction = {
    category: 'other',
    application: { company: '', role: '', kind: '', status: '', portal_url: '', portal_kind: '' },
    events: []
  };

  const isEvent = EVENT_RE.test(`${email.from}\n${text}`);
  const rule = STATUS_RULES.find(([, re]) => re.test(text));
  if (rule && !EVENT_RE.test(`${email.from}\n${email.subject}`)) {
    const company = guessCompany(email);
    const role = guessRole(email.subject) || guessRole(email.body.slice(0, 1500));
    result.category = 'job_application';
    result.application = {
      company,
      role: norm(role) === norm(company) ? '' : role,
      kind: /intern/i.test(text) ? 'Internship' : 'Job',
      status: rule[0],
      ...portalFields(pickPortalLink(email.links))
    };
  }

  if (isEvent || result.category === 'job_application') {
    const url = pickPortalLink(email.links).url;
    result.events = findDatedSentences(email).map(({ iso, allDay, sentence }): ExtractedEvent => ({
      title: `${email.subject.slice(0, 80)} — ${sentence.match(DEADLINE_WORDS)![0].toLowerCase()}`,
      organization: guessCompany(email),
      kind: /start|begin|kick/i.test(sentence) ? 'event_start' : 'submission_deadline',
      start_iso: iso,
      end_iso: '',
      all_day: allDay,
      url
    }));
    if (result.category === 'other' && result.events.length) result.category = 'hackathon_or_event';
  }
  return result;
}

export function findDatedSentences(email: Email): { iso: string; allDay: boolean; sentence: string }[] {
  const out: { iso: string; allDay: boolean; sentence: string }[] = [];
  const seen = new Set<string>();
  const res = dateRes();
  const sentences = email.body.split(/(?<=[.!?\n])\s+/).filter(s => DEADLINE_WORDS.test(s));
  for (const sentence of sentences.slice(0, 40)) {
    for (const re of res) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sentence))) {
        const monthFirst = isNaN(Number(m[1]));
        const monthName = (monthFirst ? m[1] : m[2]).toLowerCase().slice(0, 3);
        const month = MONTH_INDEX[monthName];
        const day = Number(monthFirst ? m[2] : m[1]);
        let year = m[3] ? Number(m[3]) : email.date.getUTCFullYear();

        let hour = 0, minute = 0;
        const hasTime = !!m[4];
        if (hasTime) {
          const t = m[4].replace(/\./g, '').match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])m$/i);
          if (!t) continue;
          hour = Number(t[1]); minute = t[2] ? Number(t[2]) : 0;
          if (hour < 1 || hour > 12 || minute > 59) continue;
          hour = hour % 12 + (t[3].toLowerCase() === 'p' ? 12 : 0);
        }
        if (!month || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) continue;

        // "Jan 5" in an email sent in December means next year. Compare at noon for date-only.
        if (!m[3] && Date.UTC(year, month - 1, day, hasTime ? hour : 12, minute) < email.date.getTime()) year += 1;
        if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) continue;

        const date = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
        const iso = hasTime ? `${date}T${pad(hour)}:${pad(minute)}:00` : date;
        if (seen.has(iso)) continue;
        seen.add(iso);
        out.push({ iso, allDay: !hasTime, sentence });
      }
    }
  }
  return out.slice(0, 5);
}

export function guessCompany(email: Pick<Email, 'from'>): string {
  const display = (email.from.match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || '';
  const cleaned = display
    .replace(/\b(via|from)\b.*$/i, '')
    .replace(/\b(careers?|recruiting|recruitment|talent( acquisition)?|hiring|jobs?|team|hr|people|university|campus|no-?reply|notifications?)\b/ig, '')
    .replace(/[@|•–-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const domain = ((email.from.match(/@([\w.-]+)/) || [])[1] || '').toLowerCase();
  const domainIsAts = isAtsUrl(domain) || /(mail|notify|email|noreply)\./.test(domain);
  if (cleaned && (domainIsAts || cleaned.length > 1)) return cleaned;
  const parts = domain.split('.');
  const base = parts.length >= 2 ? parts[parts.length - 2] : domain;
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : '';
}

export function guessRole(text: string): string {
  const m = text.match(/(?:application for|applying for|applied for|position:|role:)\s*(?:the\s+)?([^|–\-:,(.\n]{3,70}?)(?:\s+(?:position|role|opening|at|@)\b|[|–\-:,(.\n]|$)/i) ||
    text.match(/\bthe\s+([A-Z][\w/&+ ]{2,60}?)\s+(?:position|role|opening)\b/);
  return m ? m[1].trim() : '';
}

// "Track your application" style wording. Matched against the link text, and against the
// sentence just before the link when the link itself only says "click here".
const TRACK_TEXT_RE = /(track|check|view|see|follow|monitor|review|access)\b[^.\n]{0,40}\b(application|status|candidacy|progress)|application status|candidate (home|portal|dashboard|profile|account)|my applications?\b|application portal|status of your application/i;
const GENERIC_LINK_TEXT_RE = /^(click here|here|click|this link|link|view|open|go|visit|continue|log ?in|sign ?in|access)\W*$/i;
export const STATUS_URL_RE = /(candidate|my-?applications?|application[-_]?status|\/applications?\b|\/track|userhome|jobseeker|\/portal|\/status|\/dashboard)/i;
const CAREERS_URL_RE = /(career|\bjobs?\b|\/job\/|\/apply|recruit|talent|hiring)/i;
const NOT_PORTAL_RE = /unsubscribe|privacy|preferences|terms|mailto:|facebook|twitter|instagram|youtube|linkedin\.com\/(company|in)\/|similar jobs|recommended|job alert|more jobs|browse|explore (other |more )?(jobs|roles|opportunities)|search jobs/i;

/**
 * Picks the link that lets the user check this application's status. An explicit
 * "track your application" link wins (even when its text is just "click here"); a
 * candidate/ATS portal is next; a careers site is the fallback.
 */
export function pickPortalLink(links: EmailLink[]): { url: string; kind: PortalKind; score: number } {
  let best: { url: string; kind: PortalKind; score: number } = { url: '', kind: '', score: 0 };
  for (const { url, text = '', context = '' } of links) {
    if (NOT_PORTAL_RE.test(`${url} ${text}`)) continue;
    let score = 0;
    if (TRACK_TEXT_RE.test(text)) score += 10;
    else if ((!text || GENERIC_LINK_TEXT_RE.test(text)) && TRACK_TEXT_RE.test(context)) score += 9;
    if (STATUS_URL_RE.test(url)) score += 4;
    if (isAtsUrl(url)) score += 2;
    if (CAREERS_URL_RE.test(url)) score += 1;
    if (score > best.score) best = { url, kind: score >= 8 ? 'application_status' : 'careers_portal', score };
  }
  return best;
}

export function portalFields(pick: { url: string; kind: PortalKind }): { portal_url: string; portal_kind: PortalKind } {
  return { portal_url: pick.url, portal_kind: pick.kind };
}

/** How good a stored portal link is, from its kind if known, else its URL alone. */
export function portalRank(url: string, kind: PortalKind | string): number {
  if (!url) return 0;
  if (kind === 'application_status') return 3;
  return STATUS_URL_RE.test(url) ? 2 : 1;
}
