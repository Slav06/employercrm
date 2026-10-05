'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { activities, CHANNELS, listings, searches } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { isStage } from '@/lib/format';
import { claim, moveStage, recordPitch, recordReply } from '@/lib/pipeline';

// Server Actions are reachable by direct POST, so every action checks the key itself.

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};
const id = (f: FormData, k = 'id') => {
  const n = Number(f.get(k));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid ${k}`);
  return n;
};

function refresh(listingId?: number) {
  revalidatePath('/', 'layout');
  if (listingId) revalidatePath(`/listings/${listingId}`);
}

export async function setStage(formData: FormData) {
  const user = await requireUser();
  const listingId = id(formData);
  const stage = formData.get('stage');
  if (!isStage(stage)) throw new Error('Invalid stage');
  await moveStage(listingId, stage, user.id, str(formData, 'note'));
  if (stage !== 'skipped' && stage !== 'new') await claim(listingId, user.id);
  refresh(listingId);
}

export async function logPitch(formData: FormData) {
  const user = await requireUser();
  const listingId = id(formData);
  const channel = str(formData, 'channel') ?? 'cl_reply';
  if (!(CHANNELS as readonly string[]).includes(channel)) throw new Error('Invalid channel');
  await recordPitch({
    listingId,
    userId: user.id,
    channel,
    summary: str(formData, 'summary'),
    meta: { to: str(formData, 'to') },
    followUpDays: Number(str(formData, 'followUpDays') ?? 3),
  });
  refresh(listingId);
}

export async function logReply(formData: FormData) {
  const user = await requireUser();
  const listingId = id(formData);
  await recordReply({
    listingId,
    userId: user.id,
    channel: str(formData, 'channel') ?? 'email',
    summary: str(formData, 'summary'),
    meta: { from: str(formData, 'from') },
  });
  refresh(listingId);
}

export async function setOwner(formData: FormData) {
  await requireUser();
  const listingId = id(formData);
  const owner = Number(formData.get('ownerId'));
  const db = await getDb();
  await db
    .update(listings)
    .set({ ownerId: owner > 0 ? owner : null })
    .where(eq(listings.id, listingId));
  refresh(listingId);
}

export async function addNote(formData: FormData) {
  const user = await requireUser();
  const listingId = id(formData);
  const summary = str(formData, 'summary');
  if (!summary) return;
  const db = await getDb();
  await db.insert(activities).values({ listingId, type: 'note', userId: user.id, summary });
  await claim(listingId, user.id);
  refresh(listingId);
}

export async function setFollowUp(formData: FormData) {
  const user = await requireUser();
  const listingId = id(formData);
  const date = str(formData, 'date');
  const db = await getDb();
  const at = date ? new Date(`${date}T09:00:00`) : null;
  await db.update(listings).set({ nextFollowUpAt: at }).where(eq(listings.id, listingId));
  if (at) await db.insert(activities).values({ listingId, type: 'follow_up', userId: user.id, summary: `Follow up ${date}` });
  refresh(listingId);
}

export async function updateContact(formData: FormData) {
  await requireUser();
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

export async function saveSearch(formData: FormData) {
  await requireUser();
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
  await requireUser();
  const db = await getDb();
  const searchId = id(formData);
  const [s] = await db.select({ active: searches.active }).from(searches).where(eq(searches.id, searchId));
  if (s) await db.update(searches).set({ active: !s.active }).where(eq(searches.id, searchId));
  refresh();
}
