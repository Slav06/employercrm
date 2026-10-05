'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { activities, CHANNELS, listings, searches, type Stage } from '@/db/schema';
import { isStage, stageIndex } from '@/lib/format';
import { isIngestRunning, runAllSearches } from '@/lib/ingest';

// NOTE: no auth yet — the app is local-only. Add access control before deploying
// (Server Actions are reachable by direct POST).

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};
const id = (f: FormData, k = 'id') => {
  const n = Number(f.get(k));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid ${k}`);
  return n;
};
const daysFromNow = (days: number) => new Date(Date.now() + days * 86400_000);

function refresh(listingId?: number) {
  revalidatePath('/', 'layout');
  if (listingId) revalidatePath(`/listings/${listingId}`);
}

async function moveStage(listingId: number, to: Stage, note?: string | null) {
  const db = await getDb();
  const [cur] = await db.select({ stage: listings.stage }).from(listings).where(eq(listings.id, listingId));
  if (!cur || cur.stage === to) return;
  await db.update(listings).set({ stage: to, updatedAt: new Date() }).where(eq(listings.id, listingId));
  await db.insert(activities).values({
    listingId,
    type: 'stage',
    summary: note ?? null,
    meta: { from: cur.stage, to },
  });
}

// Only moves forward (e.g. a reply on a "meeting" listing stays at meeting).
async function advanceTo(listingId: number, to: Stage) {
  const db = await getDb();
  const [cur] = await db.select({ stage: listings.stage }).from(listings).where(eq(listings.id, listingId));
  if (cur && stageIndex(cur.stage) < stageIndex(to)) await moveStage(listingId, to);
}

export async function setStage(formData: FormData) {
  const listingId = id(formData);
  const stage = formData.get('stage');
  if (!isStage(stage)) throw new Error('Invalid stage');
  await moveStage(listingId, stage, str(formData, 'note'));
  refresh(listingId);
}

export async function logPitch(formData: FormData) {
  const listingId = id(formData);
  const channel = str(formData, 'channel') ?? 'cl_reply';
  if (!(CHANNELS as readonly string[]).includes(channel)) throw new Error('Invalid channel');
  const followUpDays = Number(str(formData, 'followUpDays') ?? 3);
  const db = await getDb();
  await db.insert(activities).values({
    listingId,
    type: 'pitch',
    channel,
    summary: str(formData, 'summary'),
    meta: { to: str(formData, 'to') },
  });
  await advanceTo(listingId, 'pitched');
  if (followUpDays > 0) {
    await db.update(listings).set({ nextFollowUpAt: daysFromNow(followUpDays) }).where(eq(listings.id, listingId));
  }
  refresh(listingId);
}

export async function logReply(formData: FormData) {
  const listingId = id(formData);
  const db = await getDb();
  await db.insert(activities).values({
    listingId,
    type: 'reply',
    channel: str(formData, 'channel') ?? 'email',
    summary: str(formData, 'summary'),
    meta: { from: str(formData, 'from') },
  });
  await advanceTo(listingId, 'replied');
  // A reply means the ball is in our court: due today unless told otherwise.
  await db.update(listings).set({ nextFollowUpAt: new Date() }).where(eq(listings.id, listingId));
  refresh(listingId);
}

export async function addNote(formData: FormData) {
  const listingId = id(formData);
  const summary = str(formData, 'summary');
  if (!summary) return;
  const db = await getDb();
  await db.insert(activities).values({ listingId, type: 'note', summary });
  refresh(listingId);
}

export async function setFollowUp(formData: FormData) {
  const listingId = id(formData);
  const date = str(formData, 'date');
  const db = await getDb();
  const at = date ? new Date(`${date}T09:00:00`) : null;
  await db.update(listings).set({ nextFollowUpAt: at }).where(eq(listings.id, listingId));
  if (at) await db.insert(activities).values({ listingId, type: 'follow_up', summary: `Follow up ${date}` });
  refresh(listingId);
}

export async function updateContact(formData: FormData) {
  const listingId = id(formData);
  const db = await getDb();
  await db
    .update(listings)
    .set({
      company: str(formData, 'company'),
      contactName: str(formData, 'contactName'),
      contactEmail: str(formData, 'contactEmail'),
      contactPhone: str(formData, 'contactPhone'),
      website: str(formData, 'website'),
      notes: str(formData, 'notes'),
      updatedAt: new Date(),
    })
    .where(eq(listings.id, listingId));
  refresh(listingId);
}

export async function fetchNow() {
  if (!isIngestRunning()) {
    // Runs in the background on the long-lived local server; progress shows up in fetch_runs.
    runAllSearches({ log: (m) => console.log(`[ingest] ${m}`) }).then(
      () => revalidatePath('/', 'layout'),
      (e) => console.error('[ingest]', e),
    );
  }
  revalidatePath('/', 'layout');
}

export async function saveSearch(formData: FormData) {
  const db = await getDb();
  const area = str(formData, 'area');
  const category = str(formData, 'category');
  if (!area || !/^[a-z]+$/.test(area) || !category || !/^[a-z]{3}$/.test(category)) {
    throw new Error('Area and category must be Craigslist slugs, e.g. miami / ofc');
  }
  const values = {
    name: str(formData, 'name') ?? `${area} ${category}`,
    area,
    category,
    query: str(formData, 'query') ?? '',
    excludeTerms: str(formData, 'excludeTerms') ?? '',
  };
  const existing = formData.get('id');
  if (existing) await db.update(searches).set(values).where(eq(searches.id, id(formData)));
  else await db.insert(searches).values(values);
  refresh();
}

export async function toggleSearch(formData: FormData) {
  const db = await getDb();
  const searchId = id(formData);
  const [s] = await db.select({ active: searches.active }).from(searches).where(eq(searches.id, searchId));
  if (s) await db.update(searches).set({ active: !s.active }).where(eq(searches.id, searchId));
  refresh();
}
