'use server';

import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { emailMessages, gmailAccounts, listings } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { decrypt } from '@/lib/gmail/crypto';
import { revoke } from '@/lib/gmail/google';
import { linkMessage, syncAccount } from '@/lib/gmail/sync';

export async function syncMyGmail() {
  const user = await requireUser();
  const db = await getDb();
  const [acc] = await db.select({ id: gmailAccounts.id }).from(gmailAccounts).where(eq(gmailAccounts.userId, user.id));
  if (acc) await syncAccount(acc.id, { force: true });
  revalidatePath('/', 'layout');
}

export async function disconnectGmail() {
  const user = await requireUser();
  const db = await getDb();
  const [acc] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.userId, user.id));
  if (!acc) return;
  try {
    await revoke(decrypt(acc.refreshTokenEnc));
  } catch {}
  // Timeline entries already logged stay; stored email copies go with the account.
  await db.delete(gmailAccounts).where(eq(gmailAccounts.id, acc.id));
  revalidatePath('/', 'layout');
}

// Accepts "#123", "123", or a Craigslist URL.
async function resolveListing(ref: string) {
  const db = await getDb();
  const id = ref.match(/^#?(\d{1,8})$/)?.[1];
  if (id) {
    const [l] = await db.select({ id: listings.id }).from(listings).where(eq(listings.id, Number(id)));
    return l?.id ?? null;
  }
  const url = ref.split(/[?#]/)[0].replace(/\/+$/, '');
  const postId = url.match(/\/(\d{9,11})(?:\.html)?$/)?.[1];
  const [l] = await db
    .select({ id: listings.id })
    .from(listings)
    .where(or(eq(listings.url, url), postId ? eq(listings.postId, postId) : sql`false`))
    .limit(1);
  return l?.id ?? null;
}

export async function linkEmail(formData: FormData) {
  await requireUser();
  const messageId = Number(formData.get('messageId'));
  const ref = String(formData.get('listing') ?? '').trim();
  const listingId = await resolveListing(ref);
  if (!listingId) throw new Error('Listing not found — use the #number from the listing page or its Craigslist link');
  await linkMessage(messageId, listingId);
  revalidatePath('/', 'layout');
}

export async function dismissEmail(formData: FormData) {
  await requireUser();
  const db = await getDb();
  await db
    .update(emailMessages)
    .set({ dismissed: true })
    .where(and(eq(emailMessages.id, Number(formData.get('messageId'))), isNull(emailMessages.listingId)));
  revalidatePath('/', 'layout');
}
