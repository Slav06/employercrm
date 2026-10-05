import { and, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { listings } from '@/db/schema';

const likeEscape = (s: string) => s.replace(/[\\%_]/g, '\\$&');

export type Match = { listingId: number; by: 'link' | 'relay' | 'contact' | 'subject' };

export const isCraigslistAddr = (a: string) => /@([a-z0-9-]+\.)*craigslist\.org$/.test(a);

// Pull Craigslist posting references out of an email body. Old-style URLs end in the
// numeric post id; new-style /view/d/<slug>/<id> URLs end in an opaque id we store in the URL.
export function craigslistRefs(text: string) {
  const urls = [...text.matchAll(/https?:\/\/[a-z0-9.-]*craigslist\.org\/[^\s"'<>)\]]+/gi)].map((m) =>
    m[0].replace(/[.,;]+$/, ''),
  );
  const postIds = new Set<string>();
  const tails = new Set<string>();
  for (const u of urls) {
    const path = u.split(/[?#]/)[0];
    const num = path.match(/\/(\d{9,11})(?:\.html)?$/);
    if (num) postIds.add(num[1]);
    const tail = path.split('/').filter(Boolean).pop();
    if (tail && tail.length >= 10) tails.add(tail.replace(/\.html$/, ''));
  }
  return { postIds: [...postIds], tails: [...tails] };
}

export const normalizeSubject = (s: string) =>
  s
    .replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// Match an outgoing email to a listing: posting link > known relay address > contact email > exact title.
export async function matchSent(input: { to: string[]; subject: string; body: string }): Promise<Match | null> {
  const db = await getDb();
  const { postIds, tails } = craigslistRefs(input.body);

  if (postIds.length || tails.length) {
    const conds = [];
    if (postIds.length) conds.push(inArray(listings.postId, postIds));
    for (const t of tails) conds.push(ilike(listings.url, `%/${likeEscape(t)}`));
    const [hit] = await db.select({ id: listings.id }).from(listings).where(or(...conds)).limit(1);
    if (hit) return { listingId: hit.id, by: 'link' };
  }

  const relays = input.to.filter(isCraigslistAddr);
  if (relays.length) {
    const [hit] = await db
      .select({ id: listings.id })
      .from(listings)
      .where(inArray(sql`lower(${listings.relayEmail})`, relays))
      .limit(1);
    if (hit) return { listingId: hit.id, by: 'relay' };
  }

  const direct = input.to.filter((a) => !isCraigslistAddr(a));
  for (const addr of direct) {
    const [hit] = await db
      .select({ id: listings.id })
      .from(listings)
      .where(or(eq(sql`lower(${listings.contactEmail})`, addr), ilike(listings.body, `%${likeEscape(addr)}%`)))
      .orderBy(desc(listings.postedAt))
      .limit(1);
    if (hit) return { listingId: hit.id, by: 'contact' };
  }

  // Craigslist's "reply by email" uses the posting title as the subject. Only trust a unique match.
  const subject = normalizeSubject(input.subject);
  if (subject.length >= 8 && relays.length) {
    const since = new Date(Date.now() - 90 * 86400_000);
    const hits = await db
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(sql`lower(${listings.title})`, subject), gte(listings.firstSeenAt, since)))
      .limit(2);
    if (hits.length === 1) return { listingId: hits[0].id, by: 'subject' };
  }
  return null;
}

// Incoming mail outside a tracked thread: only counts if it's from an address we know for a listing.
export async function matchReceivedFrom(from: string): Promise<number | null> {
  if (!from || isCraigslistAddr(from)) return null;
  const db = await getDb();
  const [hit] = await db
    .select({ id: listings.id })
    .from(listings)
    .where(or(eq(sql`lower(${listings.contactEmail})`, from), eq(sql`lower(${listings.relayEmail})`, from)))
    .limit(1);
  return hit?.id ?? null;
}
