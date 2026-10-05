import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// Pipeline for pitching our services to businesses that are hiring.
export const STAGES = [
  'new',
  'qualified',
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

// Each user logs in with their own secret key (only its SHA-256 is stored).
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role').$type<Role>().notNull().default('member'),
  keyHash: text('key_hash').notNull().unique(),
  active: boolean('active').notNull().default(true),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
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
