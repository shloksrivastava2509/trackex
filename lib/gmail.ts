import { googleFetch, mapLimit } from '@/lib/google';
import { extractLinks, htmlToText } from '@/lib/extract/links';
import type { Email } from '@/lib/types';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Only threads matching one of these are read at all (Gmail does the filtering server-side). */
export const SEARCH_TERMS = [
  'application', 'applied', 'applying', 'candidate', 'candidacy', 'interview', 'assessment',
  'unfortunately', 'regret', 'internship', 'intern', 'offer', 'recruiting', 'recruiter', 'hiring',
  '"coding challenge"', 'hackerrank', 'codesignal', 'codility',
  'hackathon', 'devpost', 'mlh', 'unstop', 'deadline', 'registration',
  'submission', 'fellowship', 'greenhouse', 'lever', 'workday', 'ashby'
];
// Promotions is NOT excluded: Devpost/MLH/Unstop mail often lands there.
const BASE_QUERY = `-in:chats -in:spam -in:trash {${SEARCH_TERMS.join(' ')}}`;

export function backfillQuery(days: number): string {
  return `${BASE_QUERY} newer_than:${days}d`;
}

/** Mail received after `since` (Gmail's after: takes epoch seconds). */
export function incrementalQuery(since: Date): string {
  return `${BASE_QUERY} after:${Math.floor(since.getTime() / 1000)}`;
}

interface ListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
}

export async function listMessageIds(token: string, q: string, pageToken?: string | null, max = 100) {
  const params = new URLSearchParams({ q, maxResults: String(max) });
  if (pageToken) params.set('pageToken', pageToken);
  const res = await googleFetch<ListResponse>(token, `${API}/messages?${params}`);
  return { ids: (res.messages ?? []).map(m => m.id), nextPageToken: res.nextPageToken ?? null };
}

export interface GmailPart {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string;
  payload: GmailPart;
}

export async function getMessages(token: string, ids: string[], userEmail: string): Promise<Email[]> {
  const raw = await mapLimit(ids, 10, id => googleFetch<GmailMessage>(token, `${API}/messages/${id}?format=full`));
  return raw.map(m => decodeMessage(m, userEmail));
}

const b64 = (data: string) => Buffer.from(data, 'base64url').toString('utf8');

/** Pure: Gmail API message → Email (plain text body, links with context). */
export function decodeMessage(m: GmailMessage, userEmail: string): Email {
  let plain = '';
  let html = '';
  const walk = (p: GmailPart) => {
    const data = p.body?.data;
    if (data && p.mimeType === 'text/plain' && !plain) plain = b64(data);
    if (data && p.mimeType === 'text/html' && !html) html = b64(data);
    p.parts?.forEach(walk);
  };
  walk(m.payload);
  const header = (name: string) =>
    m.payload.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  const body = (plain.trim() ? plain : htmlToText(html)).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return {
    id: m.id,
    threadId: m.threadId,
    from: header('From'),
    subject: header('Subject') || '(no subject)',
    date: new Date(Number(m.internalDate)),
    body,
    links: extractLinks(html),
    // authuser=email opens the right account even when several are signed in.
    emailLink: `https://mail.google.com/mail/?authuser=${encodeURIComponent(userEmail)}#all/${m.threadId}`
  };
}
