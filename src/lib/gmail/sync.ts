import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { emailMessages, gmailAccounts, listings, type GmailAccount } from '@/db/schema';
import { recordPitch, recordReply } from '@/lib/pipeline';
import { decrypt } from './crypto';
import {
  addresses,
  bodyForMatching,
  Gmail,
  GmailApiError,
  GoogleAuthError,
  header,
  messageDate,
  refreshAccessToken,
  type GmailMessage,
} from './google';
import { isCraigslistAddr, matchReceivedFrom, matchSent } from './match';

export const BACKFILL_DAYS = 60;
const STALE_MS = 5 * 60_000;

type Ctx = { acc: GmailAccount; gmail: Gmail; me: string };

async function accessToken(acc: GmailAccount) {
  if (acc.accessToken && acc.accessTokenExpiresAt && acc.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return acc.accessToken;
  }
  const t = await refreshAccessToken(decrypt(acc.refreshTokenEnc));
  const db = await getDb();
  await db
    .update(gmailAccounts)
    .set({ accessToken: t.access_token, accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000) })
    .where(eq(gmailAccounts.id, acc.id));
  return t.access_token;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

const decodeEntities = (s: string) =>
  s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function trackedListing(ctx: Ctx, threadId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ listingId: emailMessages.listingId })
    .from(emailMessages)
    .where(and(eq(emailMessages.accountId, ctx.acc.id), eq(emailMessages.threadId, threadId), isNotNull(emailMessages.listingId)))
    .limit(1);
  return row?.listingId ?? null;
}

async function alreadyStored(ctx: Ctx, gmailId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(and(eq(emailMessages.accountId, ctx.acc.id), eq(emailMessages.gmailId, gmailId)))
    .limit(1);
  return Boolean(row);
}

type Parsed = { m: GmailMessage; from: string; to: string[]; subject: string; snippet: string; at: Date; outgoing: boolean };

function parse(ctx: Ctx, m: GmailMessage): Parsed {
  const from = addresses(header(m, 'From'))[0] ?? '';
  return {
    m,
    from,
    to: addresses(`${header(m, 'To')},${header(m, 'Cc')}`),
    subject: header(m, 'Subject'),
    snippet: decodeEntities(m.snippet ?? ''),
    at: messageDate(m),
    outgoing: from === ctx.me || Boolean(m.labelIds?.includes('SENT')),
  };
}

// Store the message, then log it on the listing's timeline (pitch for ours, reply for theirs).
async function storeAndLog(ctx: Ctx, p: Parsed, listingId: number | null, matchedBy: string | null) {
  const db = await getDb();
  const [row] = await db
    .insert(emailMessages)
    .values({
      accountId: ctx.acc.id,
      userId: ctx.acc.userId,
      gmailId: p.m.id,
      threadId: p.m.threadId,
      direction: p.outgoing ? 'sent' : 'received',
      fromAddr: p.from,
      toAddrs: p.to.join(', '),
      subject: p.subject,
      snippet: p.snippet,
      at: p.at,
      listingId,
      matchedBy,
    })
    .onConflictDoNothing()
    .returning({ id: emailMessages.id });
  if (!row || !listingId) return;
  const activityId = await logActivity(ctx, p, listingId);
  await db.update(emailMessages).set({ activityId }).where(eq(emailMessages.id, row.id));
}

async function logActivity(ctx: Ctx, p: Parsed, listingId: number) {
  const summary = [p.subject, p.snippet].filter(Boolean).join('\n');
  const base = { listingId, userId: ctx.acc.userId, summary, at: p.at };
  if (p.outgoing) {
    const relay = p.to.find(isCraigslistAddr);
    if (relay) {
      const db = await getDb();
      await db.update(listings).set({ relayEmail: relay }).where(and(eq(listings.id, listingId), isNull(listings.relayEmail)));
    }
    return recordPitch({
      ...base,
      channel: relay ? 'cl_reply' : 'email',
      meta: { to: p.to.join(', '), gmail: true, gmailId: p.m.id },
    });
  }
  return recordReply({ ...base, channel: 'email', meta: { from: p.from, gmail: true, gmailId: p.m.id } });
}

async function processMessage(ctx: Ctx, m: GmailMessage) {
  if (m.labelIds?.some((l) => l === 'DRAFT' || l === 'SPAM')) return;
  if (await alreadyStored(ctx, m.id)) return;
  const p = parse(ctx, m);

  const tracked = await trackedListing(ctx, m.threadId);
  if (tracked) return storeAndLog(ctx, p, tracked, 'thread');

  if (p.outgoing) {
    const toCraigslist = p.to.some(isCraigslistAddr);
    const body = toCraigslist ? bodyForMatching(await ctx.gmail.message(m.id, 'full')) : '';
    const match = await matchSent({ to: p.to, subject: p.subject, body });
    // Unrelated sent mail is never stored; unmatched Craigslist pitches go to the Unmatched list.
    if (match || toCraigslist) await storeAndLog(ctx, p, match?.listingId ?? null, match?.by ?? null);
    return;
  }

  const listingId = await matchReceivedFrom(p.from);
  if (listingId) await storeAndLog(ctx, p, listingId, 'contact');
}

async function processInOrder(ctx: Ctx, ids: string[]) {
  const metas = await mapLimit(ids, 5, (id) => ctx.gmail.message(id));
  metas.sort((a, b) => messageDate(a).getTime() - messageDate(b).getTime());
  for (const m of metas) await processMessage(ctx, m);
}

export async function syncThread(ctx: Ctx, threadId: string) {
  const t = await ctx.gmail.thread(threadId);
  const msgs = (t.messages ?? []).sort((a, b) => messageDate(a).getTime() - messageDate(b).getTime());
  for (const m of msgs) await processMessage(ctx, m);
}

async function backfill(ctx: Ctx) {
  const db = await getDb();
  const { historyId } = await ctx.gmail.profile(); // cursor first, so nothing slips between scan and incremental
  const sent = await ctx.gmail.listMessageIds(`in:sent newer_than:${BACKFILL_DAYS}d to:craigslist.org`, 1000);
  await processInOrder(
    ctx,
    sent.map((s) => s.id),
  );
  const threads = await db
    .selectDistinct({ threadId: emailMessages.threadId })
    .from(emailMessages)
    .where(and(eq(emailMessages.accountId, ctx.acc.id), isNotNull(emailMessages.listingId)));
  for (const { threadId } of threads) await syncThread(ctx, threadId);
  await db.update(gmailAccounts).set({ backfillDone: true, historyId }).where(eq(gmailAccounts.id, ctx.acc.id));
}

async function incremental(ctx: Ctx) {
  const db = await getDb();
  let res;
  try {
    res = await ctx.gmail.historySince(ctx.acc.historyId!);
  } catch (e) {
    if (e instanceof GmailApiError && e.status === 404) return backfill(ctx); // cursor expired (~1 week)
    throw e;
  }
  const ids = [...new Set(res.added.filter((a) => !a.labelIds.includes('DRAFT')).map((a) => a.id))];
  await processInOrder(ctx, ids);
  await db.update(gmailAccounts).set({ historyId: res.historyId }).where(eq(gmailAccounts.id, ctx.acc.id));
}

async function context(acc: GmailAccount): Promise<Ctx> {
  return { acc, gmail: new Gmail(await accessToken(acc)), me: acc.email.toLowerCase() };
}

// Atomically claims the account so two requests don't sync the same mailbox at once.
async function claimAccount(id: number, minGapMs: number) {
  const db = await getDb();
  const [acc] = await db
    .update(gmailAccounts)
    .set({ lastSyncAt: new Date() })
    .where(
      and(
        eq(gmailAccounts.id, id),
        or(isNull(gmailAccounts.lastSyncAt), lt(gmailAccounts.lastSyncAt, new Date(Date.now() - minGapMs))),
      ),
    )
    .returning();
  return acc ?? null;
}

export type SyncResult = { email: string; ok: boolean; error?: string; skipped?: boolean };

export async function syncAccount(id: number, opts: { force?: boolean } = {}): Promise<SyncResult> {
  // Overlapping runs are harmless (messages are unique per mailbox and only logged when first stored);
  // the gap just avoids redundant work from frequent Inbox loads.
  const acc = await claimAccount(id, opts.force ? 0 : STALE_MS);
  if (!acc) return { email: '', ok: true, skipped: true };
  const db = await getDb();
  try {
    const ctx = await context(acc);
    if (!acc.backfillDone || !acc.historyId) await backfill(ctx);
    else await incremental(ctx);
    await db.update(gmailAccounts).set({ lastError: null, lastSyncAt: new Date() }).where(eq(gmailAccounts.id, id));
    return { email: acc.email, ok: true };
  } catch (e) {
    const error =
      e instanceof GoogleAuthError
        ? 'Google access was revoked or expired — reconnect Gmail in Settings.'
        : e instanceof Error
          ? e.message.slice(0, 500)
          : String(e);
    await db.update(gmailAccounts).set({ lastError: error }).where(eq(gmailAccounts.id, id));
    return { email: acc.email, ok: false, error };
  }
}

export async function syncAccounts(opts: { force?: boolean } = {}) {
  const db = await getDb();
  const accs = await db.select({ id: gmailAccounts.id }).from(gmailAccounts);
  const out: SyncResult[] = [];
  for (const a of accs) out.push(await syncAccount(a.id, opts));
  return out.filter((r) => !r.skipped);
}

// Manual link from the Unmatched list: attach, log the pitch, then pull the rest of the thread.
export async function linkMessage(messageId: number, listingId: number) {
  const db = await getDb();
  const [msg] = await db.select().from(emailMessages).where(eq(emailMessages.id, messageId));
  if (!msg || msg.listingId) return;
  const [acc] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.id, msg.accountId));
  if (!acc) return;
  await db.update(emailMessages).set({ listingId, matchedBy: 'manual' }).where(eq(emailMessages.id, messageId));
  const ctx = await context(acc);
  const p: Parsed = {
    m: { id: msg.gmailId, threadId: msg.threadId },
    from: msg.fromAddr ?? '',
    to: (msg.toAddrs ?? '').split(', ').filter(Boolean),
    subject: msg.subject ?? '',
    snippet: msg.snippet ?? '',
    at: msg.at,
    outgoing: msg.direction === 'sent',
  };
  const activityId = await logActivity(ctx, p, listingId);
  await db.update(emailMessages).set({ activityId }).where(eq(emailMessages.id, messageId));
  await syncThread(ctx, msg.threadId);
}

export const unmatchedCount = async () => {
  const db = await getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailMessages)
    .where(and(isNull(emailMessages.listingId), eq(emailMessages.dismissed, false)));
  return n;
};
