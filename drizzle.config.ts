import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Next.js keeps local secrets in .env.local; load it first, then fall back to .env.
config({ path: '.env.local' });
config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Add it to .env.local (see .env.example).');
}

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL }
});
