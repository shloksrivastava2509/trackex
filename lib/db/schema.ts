import { pgTable, text, timestamp, boolean, uuid, uniqueIndex, primaryKey, index } from 'drizzle-orm/pg-core';

/** One row per Google account that signed in. id = Google's stable account id ("sub"). */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull().default(''),
  image: text('image').notNull().default(''),
  /** Google refresh token, AES-256-GCM encrypted (lib/crypto.ts). */
  refreshTokenEnc: text('refresh_token_enc'),
  /** The "Trackex" secondary calendar this app created. */
  calendarId: text('calendar_id'),
  /** IANA zone reported by the user's browser; used for event times without an explicit zone. */
  timeZone: text('time_zone').notNull().default('UTC'),
  /** Gmail page token for the first-run 180-day backfill; null once finished. */
  backfillPageToken: text('backfill_page_token'),
  backfillDone: boolean('backfill_done').notNull().default(false),
  /** Incremental sync reads mail received after this moment (minus a small overlap). */
  syncedThrough: timestamp('synced_through', { withTimezone: true }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  syncError: text('sync_error'),
  /** A run holds this lease so the cron and "Sync now" never process the same mail twice. */
  syncLockUntil: timestamp('sync_lock_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  company: text('company').notNull(),
  role: text('role').notNull().default(''),
  type: text('type').notNull().default(''),
  status: text('status').notNull(),
  appliedOn: timestamp('applied_on', { withTimezone: true }).notNull(),
  lastUpdate: timestamp('last_update', { withTimezone: true }).notNull(),
  portalUrl: text('portal_url').notNull().default(''),
  portalKind: text('portal_kind').notNull().default(''),
  emailLink: text('email_link').notNull().default(''),
  lastSubject: text('last_subject').notNull().default(''),
  notes: text('notes').notNull().default('')
}, t => [index('applications_user_idx').on(t.userId)]);

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** organization|kind|local-day — one calendar event per deadline, however many reminder emails. */
  dedupKey: text('dedup_key').notNull(),
  title: text('title').notNull(),
  organization: text('organization').notNull().default(''),
  kind: text('kind').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  allDay: boolean('all_day').notNull().default(false),
  link: text('link').notNull().default(''),
  emailLink: text('email_link').notNull().default(''),
  calendarEventId: text('calendar_event_id'),
  calendarLink: text('calendar_link').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [uniqueIndex('events_user_dedup_idx').on(t.userId, t.dedupKey)]);

/** Gmail message ids already extracted, so overlapping sync windows never re-spend a Claude call. */
export const processedMessages = pgTable('processed_messages', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow()
}, t => [primaryKey({ columns: [t.userId, t.messageId] })]);
