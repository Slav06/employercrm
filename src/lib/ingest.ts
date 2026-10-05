import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { fetchRuns, listings, searches, type Search } from '@/db/schema';
import { BlockedError, fetchPage, parseListing, parseSearch, searchUrl } from './craigslist';

const DELAY_MS = Number(process.env.CL_DELAY_MS ?? 3000);
// Cap on listing pages opened per search per run, so a first run (or a backlog)
// stays polite. Search results are newest-first, so the cap keeps the freshest.
const MAX_NEW_PER_SEARCH = Number(process.env.CL_MAX_NEW_PER_SEARCH ?? 60);

// Craigslist blocks cloud IPs, so the deployed app never fetches; this machine does.
export const FETCH_ENABLED = !process.env.VERCEL;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function contentHash(company: string | null, title: string, body: string | null) {
  const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return createHash('sha1')
    .update(`${norm(company)}|${norm(title)}|${norm(body).slice(0, 2000)}`)
    .digest('hex');
}

function isExcluded(search: Search, text: string) {
  const terms = search.excludeTerms
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const lower = text.toLowerCase();
  return terms.some((t) => lower.includes(t));
}

export type RunSummary = { searchId: number; name: string; found: number; added: number; reposts: number; error?: string };

export async function runSearch(search: Search, log: (m: string) => void = () => {}): Promise<RunSummary> {
  const db = await getDb();
  const [run] = await db.insert(fetchRuns).values({ searchId: search.id }).returning();
  const summary: RunSummary = { searchId: search.id, name: search.name, found: 0, added: 0, reposts: 0 };

  try {
    const results = parseSearch(await fetchPage(searchUrl(search.area, search.category, search.query)));
    summary.found = results.length;
    if (results.length === 0) throw new Error('Search returned 0 results — page layout may have changed');

    const urls = results.map((r) => r.url);
    const known = await db.select({ url: listings.url }).from(listings).where(inArray(listings.url, urls));
    const knownSet = new Set(known.map((k) => k.url));
    if (knownSet.size) {
      await db.update(listings).set({ lastSeenAt: new Date() }).where(inArray(listings.url, [...knownSet]));
    }

    const fresh = results.filter((r) => !knownSet.has(r.url)).slice(0, MAX_NEW_PER_SEARCH);
    log(`${search.name}: ${results.length} results, ${fresh.length} new to open`);

    for (const r of fresh) {
      await sleep(DELAY_MS);
      const d = parseListing(await fetchPage(r.url));
      const title = d.title ?? r.title;
      const hash = contentHash(d.company, title, d.body);

      const [dupe] = await db.select({ id: listings.id }).from(listings).where(eq(listings.contentHash, hash)).limit(1);
      if (dupe) {
        // Same job reposted under a new URL: bump the original instead of adding a row.
        await db
          .update(listings)
          .set({ repostCount: sql`${listings.repostCount} + 1`, lastSeenAt: new Date(), postedAt: d.postedAt ?? undefined })
          .where(eq(listings.id, dupe.id));
        summary.reposts++;
        continue;
      }

      const excluded = isExcluded(search, `${title}\n${d.body ?? ''}`);
      await db
        .insert(listings)
        .values({
          searchId: search.id,
          url: r.url,
          postId: d.postId,
          area: search.area,
          category: search.category,
          title,
          company: d.company,
          jobTitle: d.jobTitle,
          compensation: d.compensation,
          employmentType: d.employmentType,
          location: r.location,
          city: d.city,
          region: d.region,
          postalCode: d.postalCode,
          body: d.body,
          postedAt: d.postedAt,
          validThrough: d.validThrough,
          contentHash: hash,
          excluded,
          stage: excluded ? 'skipped' : 'new',
        })
        .onConflictDoNothing();
      summary.added++;
    }
  } catch (e) {
    summary.error = e instanceof Error ? e.message : String(e);
    log(`${search.name}: ERROR ${summary.error}`);
    if (e instanceof BlockedError) throw Object.assign(e, { summary });
  } finally {
    await db
      .update(fetchRuns)
      .set({ finishedAt: new Date(), found: summary.found, added: summary.added, reposts: summary.reposts, error: summary.error ?? null })
      .where(eq(fetchRuns.id, run.id));
    await db.update(searches).set({ lastRunAt: new Date() }).where(eq(searches.id, search.id));
  }
  return summary;
}

// One run at a time per process.
const g = globalThis as unknown as { __ingestRunning?: Promise<RunSummary[]> };

export function isIngestRunning() {
  return Boolean(g.__ingestRunning);
}

export function runAllSearches(opts: { searchIds?: number[]; log?: (m: string) => void } = {}) {
  if (!FETCH_ENABLED) throw new Error('Fetching is disabled on Vercel — run `npm run fetch` locally');
  if (g.__ingestRunning) return g.__ingestRunning;
  g.__ingestRunning = (async () => {
    const db = await getDb();
    const where = opts.searchIds?.length
      ? and(eq(searches.active, true), inArray(searches.id, opts.searchIds))
      : eq(searches.active, true);
    const active = await db.select().from(searches).where(where).orderBy(searches.id);
    const out: RunSummary[] = [];
    for (const s of active) {
      try {
        out.push(await runSearch(s, opts.log));
      } catch (e) {
        // Blocked: stop the whole run rather than hammering.
        out.push((e as { summary: RunSummary }).summary);
        break;
      }
      await sleep(DELAY_MS);
    }
    return out;
  })().finally(() => {
    g.__ingestRunning = undefined;
  });
  return g.__ingestRunning;
}
