import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { APPLICATION_KINDS, EVENT_KINDS, PORTAL_KINDS, STATUSES, type Email, type Extraction } from '@/lib/types';

// Email → structured data with Claude. Returns null on any failure so the caller falls
// back to the keyword rules; a single bad email never breaks a sync.

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const MAX_BODY_CHARS = 12_000; // long newsletters are clipped; the signal is near the top
const MAX_LINKS = 40;

/** Strict structured-output schema: every property required, no extras. */
export const EXTRACTION_SCHEMA = {
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
        kind: { type: 'string', enum: [...APPLICATION_KINDS] },
        status: { type: 'string', enum: [...STATUSES, ''] },
        portal_url: { type: 'string' },
        portal_kind: { type: 'string', enum: [...PORTAL_KINDS] }
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
          kind: { type: 'string', enum: [...EVENT_KINDS] },
          start_iso: { type: 'string' },
          end_iso: { type: 'string' },
          all_day: { type: 'boolean' },
          url: { type: 'string' }
        }
      }
    }
  }
} as const;

/** Runtime validation of the model output (structured outputs constrain it; this guards the types). */
const ExtractionZ = z.object({
  category: z.enum(['job_application', 'hackathon_or_event', 'other']),
  application: z.object({
    company: z.string(),
    role: z.string(),
    kind: z.enum(APPLICATION_KINDS),
    status: z.enum([...STATUSES, '']),
    portal_url: z.string(),
    portal_kind: z.enum(PORTAL_KINDS)
  }),
  events: z.array(z.object({
    title: z.string(),
    organization: z.string(),
    kind: z.enum(EVENT_KINDS),
    start_iso: z.string(),
    end_iso: z.string(),
    all_day: z.boolean(),
    url: z.string()
  }))
});

export const EXTRACTION_SYSTEM = `You read one email from a student's inbox and extract two things: job/internship application tracking data, and dated items worth putting on their calendar.

category:
- "job_application": the email is about an application the user has ALREADY submitted or is progressing through (confirmation, under review, online assessment or take-home assignment, interview invite/scheduling, offer, rejection, withdrawal). Job alerts, recommended jobs, recruiter cold outreach about roles they did not apply to, and newsletters are "other".
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

events: every concrete date the user needs to act on or attend — interview slots, assessment / assignment / take-home due dates, registration/submission/application deadlines, hackathon start/end. Skip dates with no action attached and dates already in the past relative to the email's sent date.
- start_iso/end_iso: ISO 8601 with UTC offset (e.g. "2026-11-02T16:00:00+05:30"). Resolve relative dates ("this Friday", "within 7 days", "48 hours from now") against the email's sent date. Assume the user's time zone (given below) unless the email names another time zone.
- When no time of day is given: all_day true and start_iso is the date only ("2026-11-02").
- For a deadline, put the deadline moment in start_iso and leave end_iso "". For an interview or event with a known end, set end_iso.
- title: short and specific, e.g. "HackMIT — project submission", "Stripe — technical interview".
- url: the most relevant link from the list (meeting / assessment / registration / submission page), else "".`;

let client: Anthropic | null = null;

export function claudeEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function buildUserContent(email: Email, timeZone: string): string {
  const links = email.links.slice(0, MAX_LINKS).map(l =>
    `- [${l.text || 'no text'}] → ${l.url}${l.context ? `   (text before link: "…${l.context}")` : ''}`);
  return [
    `User time zone: ${timeZone}`,
    `Sent: ${email.date.toISOString()}`,
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    '',
    'Links in the email:',
    links.join('\n') || '(none)',
    '',
    'Body:',
    email.body.slice(0, MAX_BODY_CHARS)
  ].join('\n');
}

/** Pure: the text of a finished response → validated Extraction, or null. */
export function parseExtraction(text: string): Extraction | null {
  try {
    const parsed = ExtractionZ.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function extractWithClaude(email: Email, timeZone: string): Promise<Extraction | null> {
  if (!claudeEnabled()) return null;
  client ??= new Anthropic({ maxRetries: 3 }); // the SDK retries 429/5xx/connection errors itself
  try {
    const response = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      // Re-runs a safety-declined request on Anthropic's recommended fallback model.
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
      system: EXTRACTION_SYSTEM,
      messages: [{ role: 'user', content: buildUserContent(email, timeZone) }]
    } as Parameters<typeof client.beta.messages.create>[0]) as Anthropic.Beta.BetaMessage;

    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      console.warn(`Claude stop_reason=${response.stop_reason} for "${email.subject}"`);
      return null;
    }
    const text = response.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
    const data = parseExtraction(text);
    if (!data) console.error(`Unparseable Claude output for "${email.subject}": ${text.slice(0, 200)}`);
    return data;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      console.error('Claude API key rejected — falling back to keyword rules:', e.message);
    } else if (e instanceof Anthropic.APIError) {
      console.error(`Claude API ${e.status ?? ''} for "${email.subject}": ${e.message}`);
    } else {
      console.error(`Claude call failed for "${email.subject}":`, e);
    }
    return null;
  }
}
