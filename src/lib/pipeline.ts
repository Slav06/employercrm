import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db';
import { activities, listings, type Stage } from '@/db/schema';
import { stageIndex } from '@/lib/format';

// Shared by manual logging (Server Actions) and Gmail sync, so both follow the same rules.

const DEFAULT_FOLLOW_UP_DAYS = 3;

// First person to work a lead becomes its user; later actions by others don't change it.
export async function claim(listingId: number, userId: number) {
  const db = await getDb();
  await db
    .update(listings)
    .set({ ownerId: userId })
    .where(and(eq(listings.id, listingId), isNull(listings.ownerId)));
}

export async function moveStage(listingId: number, to: Stage, userId: number | null, note?: string | null) {
  const db = await getDb();
  const [cur] = await db.select({ stage: listings.stage }).from(listings).where(eq(listings.id, listingId));
  if (!cur || cur.stage === to) return;
  await db.update(listings).set({ stage: to, updatedAt: new Date() }).where(eq(listings.id, listingId));
  await db.insert(activities).values({
    listingId,
    type: 'stage',
    userId,
    summary: note ?? null,
    meta: { from: cur.stage, to },
  });
}

// Only moves forward (e.g. a reply on a "meeting" listing stays at meeting).
export async function advanceTo(listingId: number, to: Stage, userId: number | null) {
  const db = await getDb();
  const [cur] = await db.select({ stage: listings.stage }).from(listings).where(eq(listings.id, listingId));
  if (cur && (cur.stage === 'skipped' || stageIndex(cur.stage) < stageIndex(to))) {
    await moveStage(listingId, to, userId);
  }
}

type LogInput = {
  listingId: number;
  userId: number;
  channel: string;
  summary: string | null;
  meta?: Record<string, unknown>;
  at?: Date;
};

export async function recordPitch(input: LogInput & { followUpDays?: number }) {
  const db = await getDb();
  const at = input.at ?? new Date();
  const [a] = await db
    .insert(activities)
    .values({
      listingId: input.listingId,
      type: 'pitch',
      userId: input.userId,
      channel: input.channel,
      summary: input.summary,
      meta: input.meta ?? null,
      at,
    })
    .returning({ id: activities.id });
  await advanceTo(input.listingId, 'pitched', input.userId);
  await claim(input.listingId, input.userId);
  const days = input.followUpDays ?? DEFAULT_FOLLOW_UP_DAYS;
  if (days > 0) {
    await db
      .update(listings)
      .set({ nextFollowUpAt: new Date(at.getTime() + days * 86400_000) })
      .where(eq(listings.id, input.listingId));
  }
  return a.id;
}

export async function recordReply(input: LogInput) {
  const db = await getDb();
  const [a] = await db
    .insert(activities)
    .values({
      listingId: input.listingId,
      type: 'reply',
      userId: input.userId,
      channel: input.channel,
      summary: input.summary,
      meta: input.meta ?? null,
      at: input.at ?? new Date(),
    })
    .returning({ id: activities.id });
  await advanceTo(input.listingId, 'replied', input.userId);
  await claim(input.listingId, input.userId);
  // A reply means the ball is in our court: due now unless told otherwise.
  await db.update(listings).set({ nextFollowUpAt: new Date() }).where(eq(listings.id, input.listingId));
  return a.id;
}
