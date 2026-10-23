import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { saveGoogleAccount } from '@/lib/users';

/**
 * The only permissions Trackex asks for:
 *  - gmail.readonly: read job/hackathon emails (never sends, deletes or labels mail)
 *  - calendar.app.created: create and manage ONLY the "Trackex" calendar this app makes,
 *    not your other calendars
 */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          scope: ['openid', 'email', 'profile', GMAIL_SCOPE, CALENDAR_SCOPE].join(' '),
          access_type: 'offline', // a refresh token, so syncing works while you're away
          prompt: 'consent', // Google only returns a refresh token on the consent screen
          include_granted_scopes: 'true'
        }
      }
    })
  ],
  session: { strategy: 'jwt' },
  trustHost: true, // Vercel sets the host; also needed for `next start` locally
  pages: { signIn: '/', error: '/' },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== 'google' || !account.providerAccountId) return false;
      // Google's consent screen lets people untick individual permissions.
      const granted = String(account.scope ?? '').split(' ');
      if (!granted.includes(GMAIL_SCOPE) || !granted.includes(CALENDAR_SCOPE)) return '/?error=scopes';
      await saveGoogleAccount({
        id: account.providerAccountId,
        email: String(profile?.email ?? ''),
        name: String(profile?.name ?? ''),
        image: String((profile as { picture?: string } | undefined)?.picture ?? ''),
        refreshToken: account.refresh_token ?? null
      });
      return true;
    },
    async jwt({ token, account }) {
      if (account?.providerAccountId) token.sub = account.providerAccountId;
      return token;
    },
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    }
  }
});
