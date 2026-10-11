'use server';

import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { emailMessages, gmailAccounts, listings } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { decrypt } from '@/lib/gmail/crypto';
import { buildRawEmail, Gmail, header, revoke } from '@/lib/gmail/google';
import { isCraigslistAddr } from '@/lib/gmail/match';
import { accessToken, linkMessage, syncAccount } from '@/lib/gmail/sync';
import { recordPitch } from '@/lib/pipeline';

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Compose or reply from the CRM: sends through the signed-in user's own Gmail, continues the
// lead's existing thread when there is one, and logs the message as a pitch on the timeline.
export async function sendEmail(formData: FormData) {
  const user = await requireUser();
  const db = await getDb();

  const listingId = Number(formData.get('id'));
  if (!Number.isInteger(listingId) || listingId <= 0) throw new Error('Invalid listing');
  const to = String(formData.get('to') ?? '').trim().toLowerCase();
  const subject = String(formData.get('subject') ?? '').trim();
  const text = String(formData.get('body') ?? '').trim();
  if (!EMAIL_RE.test(to)) throw new Error('Enter a valid recipient email address.');
  if (!text) throw new Error('Write a message before sending.');

  const [acc] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.userId, user.id));
  if (!acc) throw new Error('Connect your Gmail in Settings before sending.');

  const gmail = new Gmail(await accessToken(acc));

  // Thread onto the most recent message for this lead in the sender's own mailbox, if any.
  const [prev] = await db
    .select()
    .from(emailMessages)
    .where(and(eq(emailMessages.accountId, acc.id), eq(emailMessages.listingId, listingId)))
    .orderBy(desc(emailMessages.at))
    .limit(1);

  let threadId: string | undefined;
  let inReplyTo: string | null = null;
  let references: string | null = null;
  if (prev) {
    threadId = prev.threadId;
    try {
      const orig = await gmail.messageHeaders(prev.gmailId, ['Message-ID', 'References']);
      inReplyTo = header(orig, 'Message-ID') || null;
      references = header(orig, 'References') || null;
    } catch {
      // Headers are a nicety for threading; sending still works without them.
    }
  }

  const raw = buildRawEmail({ from: acc.email, to, subject: subject || '(no subject)', text, inReplyTo, references });
  const sent = await gmail.send(raw, threadId);

  const relay = isCraigslistAddr(to) ? to : null;
  if (relay) {
    await db.update(listings).set({ relayEmail: relay }).where(and(eq(listings.id, listingId), isNull(listings.relayEmail)));
  }

  // Store our copy now so the next sync won't re-log it (unique on accountId+gmailId).
  const [row] = await db
    .insert(emailMessages)
    .values({
      accountId: acc.id,
      userId: user.id,
      gmailId: sent.id,
      threadId: sent.threadId,
      direction: 'sent',
      fromAddr: acc.email,
      toAddrs: to,
      subject,
      snippet: text.slice(0, 200),
      at: new Date(),
      listingId,
      matchedBy: 'manual',
    })
    .onConflictDoNothing()
    .returning({ id: emailMessages.id });

  const activityId = await recordPitch({
    listingId,
    userId: user.id,
    channel: relay ? 'cl_reply' : 'email',
    summary: [subject, text].filter(Boolean).join('\n'),
    meta: { to, gmail: true, gmailId: sent.id, sentFromCrm: true },
  });
  if (row) await db.update(emailMessages).set({ activityId }).where(eq(emailMessages.id, row.id));

  revalidatePath('/', 'layout');
  revalidatePath(`/listings/${listingId}`);
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
