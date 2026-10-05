import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Pipeline for pitching our services to businesses that are hiring.
export const STAGES = [
  'new',
  'pitched',
  'replied',
  'meeting',
  'proposal',
  'won',
  'lost',
  'skipped',
] as const;
export type Stage = (typeof STAGES)[number];

export const ACTIVITY_TYPES = ['pitch', 'reply', 'note', 'stage', 'follow_up'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const CHANNELS = ['cl_reply', 'email', 'phone', 'text', 'website', 'linkedin', 'other'] as const;

export const ROLES = ['admin', 'member'] as const;
export type Role = (typeof ROLES)[number];

// Users sign in with name + an easy key (word + 2 digits, e.g. tiger42). Keys are
// stored as salted scrypt hashes; the browser only ever holds a session token.
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    role: text('role').$type<Role>().notNull().default('member'),
    keyHash: text('key_hash').notNull(),
    active: boolean('active').notNull().default(true),
    selfRegistered: boolean('self_registered').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_name_lower_idx').on(sql`lower(${t.name})`)],
);

export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Failed logins and sign-ups, for throttling guesses against short keys.
export const authAttempts = pgTable(
  'auth_attempts',
  {
    id: serial('id').primaryKey(),
    kind: text('kind').$type<'login_fail' | 'register'>().notNull(),
    name: text('name'),
    ip: text('ip'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_attempts_kind_at_idx').on(t.kind, t.at)],
);

export const searches = pgTable('searches', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  source: text('source').notNull().default('craigslist'),
  area: text('area').notNull(), // craigslist area slug: miami, newyork, sfbay
  category: text('category').notNull(), // craigslist category: ofc, mar, jjj
  query: text('query').notNull().default(''),
  excludeTerms: text('exclude_terms').notNull().default(''), // comma separated
  active: boolean('active').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const listings = pgTable(
  'listings',
  {
    id: serial('id').primaryKey(),
    source: text('source').notNull().default('craigslist'),
    searchId: integer('search_id').references(() => searches.id, { onDelete: 'set null' }),
    url: text('url').notNull().unique(),
    postId: text('post_id'),
    area: text('area'),
    category: text('category'),
    title: text('title').notNull(),
    company: text('company'),
    jobTitle: text('job_title'),
    compensation: text('compensation'),
    employmentType: text('employment_type'),
    location: text('location'),
    city: text('city'),
    region: text('region'),
    postalCode: text('postal_code'),
    body: text('body'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    validThrough: timestamp('valid_through', { withTimezone: true }),
    contentHash: text('content_hash').notNull(),
    repostCount: integer('repost_count').notNull().default(0),
    excluded: boolean('excluded').notNull().default(false),
    stage: text('stage').$type<Stage>().notNull().default('new'),
    // Who's working this lead: the first user to act on it (pitch, reply, note, stage move).
    ownerId: integer('owner_id').references(() => users.id, { onDelete: 'set null' }),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    // Craigslist anonymized reply address (xxxx@job.craigslist.org), learned from sent pitches.
    relayEmail: text('relay_email'),
    contactPhone: text('contact_phone'),
    website: text('website'),
    notes: text('notes'),
    nextFollowUpAt: timestamp('next_follow_up_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('listings_stage_idx').on(t.stage),
    index('listings_hash_idx').on(t.contentHash),
    index('listings_posted_idx').on(t.postedAt),
    index('listings_follow_up_idx').on(t.nextFollowUpAt),
    index('listings_owner_idx').on(t.ownerId),
    index('listings_post_id_idx').on(t.postId),
    index('listings_relay_idx').on(sql`lower(${t.relayEmail})`),
  ],
);

// One timeline per listing: pitches we sent, replies we got, notes, stage changes.
export const activities = pgTable(
  'activities',
  {
    id: serial('id').primaryKey(),
    listingId: integer('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    type: text('type').$type<ActivityType>().notNull(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    channel: text('channel'),
    summary: text('summary'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('activities_listing_idx').on(t.listingId), index('activities_type_at_idx').on(t.type, t.at)],
);

// One connected Google Workspace mailbox per user (read-only). Refresh token is AES-GCM encrypted.
export const gmailAccounts = pgTable('gmail_accounts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  accessToken: text('access_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  historyId: text('history_id'), // Gmail history cursor for incremental sync
  backfillDone: boolean('backfill_done').notNull().default(false),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastError: text('last_error'),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
});

// Only CRM-related mail is stored: pitches to listings (matched or not) and messages in their threads.
export const emailMessages = pgTable(
  'email_messages',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => gmailAccounts.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    gmailId: text('gmail_id').notNull(),
    threadId: text('thread_id').notNull(),
    direction: text('direction').$type<'sent' | 'received'>().notNull(),
    fromAddr: text('from_addr'),
    toAddrs: text('to_addrs'),
    subject: text('subject'),
    snippet: text('snippet'),
    at: timestamp('at', { withTimezone: true }).notNull(),
    listingId: integer('listing_id').references(() => listings.id, { onDelete: 'set null' }),
    matchedBy: text('matched_by'), // link | relay | contact | subject | thread | manual
    activityId: integer('activity_id').references(() => activities.id, { onDelete: 'set null' }),
    dismissed: boolean('dismissed').notNull().default(false),
  },
  (t) => [
    uniqueIndex('email_messages_account_gmail_idx').on(t.accountId, t.gmailId),
    index('email_messages_thread_idx').on(t.accountId, t.threadId),
    index('email_messages_listing_idx').on(t.listingId),
  ],
);

export const fetchRuns = pgTable('fetch_runs', {
  id: serial('id').primaryKey(),
  searchId: integer('search_id').references(() => searches.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  found: integer('found').notNull().default(0),
  added: integer('added').notNull().default(0),
  reposts: integer('reposts').notNull().default(0),
  error: text('error'),
});

export type User = typeof users.$inferSelect;
export type Search = typeof searches.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type FetchRun = typeof fetchRuns.$inferSelect;
export type GmailAccount = typeof gmailAccounts.$inferSelect;
export type EmailMessage = typeof emailMessages.$inferSelect;
