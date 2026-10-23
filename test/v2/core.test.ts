import { describe, test, expect } from 'vitest';
import { buildEvent, instantToLocal, localToInstant, parseWhen, TIMED_REMINDERS_MIN, ALL_DAY_REMINDERS_MIN } from '@/lib/calendar';
import { decodeMessage, incrementalQuery, type GmailMessage } from '@/lib/gmail';
import { EXTRACTION_SCHEMA, parseExtraction } from '@/lib/extract/claude';
import { encrypt, decrypt } from '@/lib/crypto';
import { STATUSES, type ExtractedEvent } from '@/lib/types';

const src = { emailLink: 'https://mail.google.com/mail/?authuser=a%40b.c#all/t1', subject: 'Interview invite' };
const ev = (o: Partial<ExtractedEvent>): ExtractedEvent => ({
  title: 'Stripe — technical interview', organization: 'Stripe', kind: 'interview',
  start_iso: '', end_iso: '', all_day: false, url: '', ...o
});

describe('time zones', () => {
  test('wall clock ↔ instant round-trips in a zone with an offset', () => {
    const t = localToInstant('2026-11-02T16:00:00', 'Asia/Kolkata');
    expect(t.toISOString()).toBe('2026-11-02T10:30:00.000Z');
    expect(instantToLocal(t, 'Asia/Kolkata')).toBe('2026-11-02T16:00:00');
  });

  test('handles a DST zone on both sides of the change', () => {
    expect(localToInstant('2026-03-07T09:00:00', 'America/New_York').toISOString()).toBe('2026-03-07T14:00:00.000Z'); // EST
    expect(localToInstant('2026-03-09T09:00:00', 'America/New_York').toISOString()).toBe('2026-03-09T13:00:00.000Z'); // EDT
  });

  test('an offset time from Claude becomes the user\'s wall clock', () => {
    expect(parseWhen('2026-11-02T16:00:00+05:30', false, 'America/New_York')).toEqual({ kind: 'local', local: '2026-11-02T05:30:00' });
  });

  test('date-only and naive local strings are kept as-is', () => {
    expect(parseWhen('2026-11-02', false, 'UTC')).toEqual({ kind: 'date', date: '2026-11-02' });
    expect(parseWhen('2026-11-02T09:15', false, 'UTC')).toEqual({ kind: 'local', local: '2026-11-02T09:15:00' });
    expect(parseWhen('not a date', false, 'UTC')).toBeNull();
  });
});

describe('buildEvent', () => {
  test('interview: real start, 1 h default length, reminders 1 day and 1 hour before', () => {
    const b = buildEvent(ev({ start_iso: '2026-11-02T16:00:00+05:30' }), 'Asia/Kolkata', src)!;
    expect(b.resource.start).toEqual({ dateTime: '2026-11-02T16:00:00', timeZone: 'Asia/Kolkata' });
    expect(b.resource.end).toEqual({ dateTime: '2026-11-02T17:00:00', timeZone: 'Asia/Kolkata' });
    expect(b.resource.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 1440 }, { method: 'popup', minutes: 60 }]
    });
    expect(TIMED_REMINDERS_MIN).toEqual([1440, 60]);
    expect(b.startsAt.toISOString()).toBe('2026-11-02T10:30:00.000Z');
    expect(b.dedupKey).toBe('stripe|interview|2026-11-02');
  });

  test('interview with an end time keeps it', () => {
    const b = buildEvent(ev({ start_iso: '2026-11-02T16:00:00+05:30', end_iso: '2026-11-02T16:45:00+05:30' }), 'Asia/Kolkata', src)!;
    expect(b.resource.end).toEqual({ dateTime: '2026-11-02T16:45:00', timeZone: 'Asia/Kolkata' });
  });

  test('deadline: a 30-minute block ending at the deadline; startsAt is the deadline itself', () => {
    const b = buildEvent(ev({ kind: 'assessment_due', title: 'Acme OA', organization: 'Acme', start_iso: '2026-10-30T23:59:00' }), 'Asia/Kolkata', src)!;
    expect(b.resource.start).toEqual({ dateTime: '2026-10-30T23:29:00', timeZone: 'Asia/Kolkata' });
    expect(b.resource.end).toEqual({ dateTime: '2026-10-30T23:59:00', timeZone: 'Asia/Kolkata' });
    expect(instantToLocal(b.startsAt, 'Asia/Kolkata')).toBe('2026-10-30T23:59:00');
    expect(b.endsAt).toBeNull();
  });

  test('all-day: date-only start, exclusive end the next day, day-before reminders', () => {
    const b = buildEvent(ev({ kind: 'application_deadline', title: 'MLH Fellowship', organization: 'MLH', start_iso: '2026-11-02', all_day: true }), 'UTC', src)!;
    expect(b.allDay).toBe(true);
    expect(b.resource.start).toEqual({ date: '2026-11-02' });
    expect(b.resource.end).toEqual({ date: '2026-11-03' });
    expect((b.resource.reminders as { overrides: { minutes: number }[] }).overrides.map(o => o.minutes)).toEqual(ALL_DAY_REMINDERS_MIN);
  });

  test('multi-day hackathon spans start..end inclusive', () => {
    const b = buildEvent(ev({ kind: 'event_start', title: 'HackMIT', organization: 'HackMIT', start_iso: '2026-11-07', end_iso: '2026-11-08', all_day: true }), 'UTC', src)!;
    expect(b.resource.end).toEqual({ date: '2026-11-09' });
  });

  test('links back to the source email', () => {
    const b = buildEvent(ev({ start_iso: '2026-11-02T10:00:00Z', url: 'https://meet.example.com/x' }), 'UTC', src)!;
    expect(b.resource.source).toEqual({ title: 'Trackex', url: src.emailLink });
    expect(String(b.resource.description)).toContain('https://meet.example.com/x');
  });

  test('unparseable start → no event', () => {
    expect(buildEvent(ev({ start_iso: 'sometime next week' }), 'UTC', src)).toBeNull();
  });
});

describe('Gmail decoding', () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  const msg: GmailMessage = {
    id: 'm1', threadId: 't1', internalDate: String(Date.parse('2026-10-20T10:00:00Z')),
    payload: {
      mimeType: 'multipart/alternative',
      headers: [{ name: 'From', value: '"Stripe Recruiting" <no-reply@greenhouse.io>' }, { name: 'Subject', value: 'Thanks for applying' }],
      parts: [
        { mimeType: 'text/plain', body: { data: b64('Thank you for applying.\r\n\r\n\r\n\r\nTrack it below.') } },
        { mimeType: 'text/html', body: { data: b64('<p>To track your application, <a href="https://my.greenhouse.io/x?a=1&amp;b=2">click here</a>.</p>') } }
      ]
    }
  };

  test('multipart message → plain body, links with context, account-safe Gmail link', () => {
    const e = decodeMessage(msg, 'me@example.com');
    expect(e.subject).toBe('Thanks for applying');
    expect(e.from).toContain('greenhouse.io');
    expect(e.date.toISOString()).toBe('2026-10-20T10:00:00.000Z');
    expect(e.body).toBe('Thank you for applying.\n\nTrack it below.');
    expect(e.links).toEqual([{ url: 'https://my.greenhouse.io/x?a=1&b=2', text: 'click here', context: 'To track your application,' }]);
    expect(e.emailLink).toBe('https://mail.google.com/mail/?authuser=me%40example.com#all/t1');
  });

  test('HTML-only message falls back to text from the HTML', () => {
    const e = decodeMessage({ ...msg, payload: { mimeType: 'text/html', headers: [], body: { data: b64('<div>Unfortunately we will not proceed.</div>') } } }, 'me@example.com');
    expect(e.body).toContain('Unfortunately we will not proceed.');
    expect(e.subject).toBe('(no subject)');
  });

  test('incremental query uses epoch seconds', () => {
    expect(incrementalQuery(new Date('2026-10-20T00:00:00Z'))).toMatch(/after:1792454400$/);
  });
});

describe('Claude output', () => {
  const walk = (node: Record<string, unknown>, path = 'root'): void => {
    if (node.type === 'object') {
      expect(node.additionalProperties, path).toBe(false);
      expect([...(node.required as string[])].sort(), path).toEqual(Object.keys(node.properties as object).sort());
      for (const [k, v] of Object.entries(node.properties as Record<string, Record<string, unknown>>)) walk(v, `${path}.${k}`);
    } else if (node.type === 'array') walk(node.items as Record<string, unknown>, `${path}[]`);
  };

  test('schema is strict and its status enum matches STATUSES', () => {
    walk(EXTRACTION_SCHEMA as unknown as Record<string, unknown>);
    expect(EXTRACTION_SCHEMA.properties.application.properties.status.enum).toEqual([...STATUSES, '']);
  });

  test('parseExtraction validates, and rejects junk', () => {
    const ok = { category: 'other', application: { company: '', role: '', kind: '', status: '', portal_url: '', portal_kind: '' }, events: [] };
    expect(parseExtraction(JSON.stringify(ok))).toEqual(ok);
    expect(parseExtraction('{"category":"maybe"}')).toBeNull();
    expect(parseExtraction('not json')).toBeNull();
  });
});

describe('token encryption', () => {
  test('round-trips and detects tampering', () => {
    process.env.TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
    const sealed = encrypt('1//refresh-token');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(decrypt(sealed)).toBe('1//refresh-token');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
});
