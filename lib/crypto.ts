import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Google refresh tokens grant ongoing access to a user's mail, so they are never stored
// in plain text: AES-256-GCM with a server-only key (TOKEN_KEY, 32 bytes base64).

function key(): Buffer {
  const raw = process.env.TOKEN_KEY;
  if (!raw) throw new Error('TOKEN_KEY is not set');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('TOKEN_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)');
  return buf;
}

/** → "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map(p => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

export function decrypt(sealed: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised encrypted token format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
