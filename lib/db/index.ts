import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

let client: ReturnType<typeof makeDb> | null = null;

function makeDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return drizzle(neon(url), { schema });
}

/** Lazily created so pages that never touch the database (landing, demo) build without one. */
export function db() {
  client ??= makeDb();
  return client;
}

export { schema };
