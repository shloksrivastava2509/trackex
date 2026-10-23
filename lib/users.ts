import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { encrypt } from '@/lib/crypto';

export async function saveGoogleAccount(a: {
  id: string; email: string; name: string; image: string; refreshToken: string | null;
}) {
  const profile = { email: a.email, name: a.name, image: a.image };
  // A fresh refresh token replaces the old one and clears any "please sign in again" state.
  const token = a.refreshToken ? { refreshTokenEnc: encrypt(a.refreshToken), syncError: null } : {};
  await db().insert(schema.users).values({ id: a.id, ...profile, ...token })
    .onConflictDoUpdate({ target: schema.users.id, set: { ...profile, ...token } });
}

export async function getUser(id: string) {
  const [row] = await db().select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return row ?? null;
}
