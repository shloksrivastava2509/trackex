import type { EmailLink } from '@/lib/types';

export function htmlToText(html: string): string {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ');
}

export function extractLinks(html: string): EmailLink[] {
  const links: EmailLink[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = m[1].replace(/&amp;/g, '&').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    // The sentence before the link, so "To track your application, click here" is understood.
    const context = htmlToText(html.slice(Math.max(0, m.index - 600), m.index)).replace(/\s+/g, ' ').trim().slice(-140);
    links.push({ url, text: htmlToText(m[2]).replace(/\s+/g, ' ').trim().slice(0, 80), context });
  }
  return links;
}
