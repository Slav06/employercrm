// Gmail sync against a fake Gmail API and a throwaway PGlite DB.
//   npm run test:gmail
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'crm-gmail-test-'));
process.env.PGLITE_DIR = dir;
delete process.env.DATABASE_URL;
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.GMAIL_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');

// ---------- fake Gmail ----------
type Msg = {
  id: string;
  threadId: string;
  labelIds: string[];
  from: string;
  to: string;
  subject: string;
  body?: string;
  at: number;
  snippet?: string;
};
const mailbox: Msg[] = [];
let historyId = 100;
const history: { id: string; threadId: string; labelIds: string[]; h: number }[] = [];
let historyExpired = false;
let refreshCalls = 0;
let refreshFails = false;

function add(m: Msg, viaHistory = false) {
  mailbox.push(m);
  historyId++;
  if (viaHistory) history.push({ id: m.id, threadId: m.threadId, labelIds: m.labelIds, h: historyId });
}

const toGmail = (m: Msg, full: boolean) => ({
  id: m.id,
  threadId: m.threadId,
  labelIds: m.labelIds,
  snippet: m.snippet ?? (m.body ?? '').slice(0, 100),
  internalDate: String(m.at),
  payload: {
    mimeType: 'text/plain',
    headers: [
      { name: 'From', value: m.from },
      { name: 'To', value: m.to },
      { name: 'Subject', value: m.subject },
    ],
    body: full ? { data: Buffer.from(m.body ?? '').toString('base64url') } : {},
  },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === 'oauth2.googleapis.com') {
    refreshCalls++;
    if (refreshFails) return json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
    return json({ access_token: `at-${refreshCalls}`, expires_in: 3600 });
  }
  if (url.hostname !== 'gmail.googleapis.com') return realFetch(input, init);
  const p = url.pathname.replace('/gmail/v1/users/me', '');
  const q = url.searchParams;
  if (p === '/profile') return json({ emailAddress: 'me@acme.com', historyId: String(historyId) });
  if (p === '/messages') {
    const query = q.get('q') ?? '';
    const hits = mailbox.filter((m) => query.includes('in:sent') && m.labelIds.includes('SENT') && /craigslist\.org/.test(m.to));
    return json({ messages: hits.map((m) => ({ id: m.id, threadId: m.threadId })) });
  }
  let mm = p.match(/^\/messages\/(.+)$/);
  if (mm) {
    const m = mailbox.find((x) => x.id === mm![1]);
    return m ? json(toGmail(m, q.get('format') === 'full')) : json({}, 404);
  }
  mm = p.match(/^\/threads\/(.+)$/);
  if (mm) return json({ id: mm[1], messages: mailbox.filter((x) => x.threadId === mm![1]).map((m) => toGmail(m, false)) });
  if (p === '/history') {
    if (historyExpired) return json({ error: { code: 404 } }, 404);
    const start = Number(q.get('startHistoryId'));
    const items = history.filter((h) => h.h > start);
    return json({
      history: items.map((h) => ({ messagesAdded: [{ message: { id: h.id, threadId: h.threadId, labelIds: h.labelIds } }] })),
      historyId: String(historyId),
    });
  }
  return json({ error: 'unhandled ' + p }, 500);
}) as typeof fetch;

// ---------- test ----------
async function main() {
  const { getDb } = await import('@/db');
  const { activities, emailMessages, gmailAccounts, listings, users } = await import('@/db/schema');
  const { encrypt } = await import('@/lib/gmail/crypto');
  const { syncAccount, linkMessage } = await import('@/lib/gmail/sync');
  const { eq, and } = await import('drizzle-orm');
  const db = await getDb();

  const [u] = await db.insert(users).values({ name: 'Ann', keyHash: 'x' }).returning();
  const L = async (v: Partial<typeof listings.$inferInsert> & { title: string }) =>
    (
      await db
        .insert(listings)
        .values({ url: `https://www.craigslist.org/view/d/x/${v.title.replace(/\W/g, '')}`, contentHash: v.title, ...v })
        .returning()
    )[0];
  const byLink = await L({ title: 'Office Admin Needed', url: 'https://www.craigslist.org/view/d/miami-office-admin/aGt1BjYijwPMoW5gNhiWek' });
  const byOldLink = await L({ title: 'Receptionist', postId: '7978142457' });
  const bySubject = await L({ title: 'Marketing Coordinator - Brickell' });
  const byContact = await L({ title: 'Bookkeeper', body: 'Send resume to hiring@smallbiz.com thanks' });
  const [acc] = await db
    .insert(gmailAccounts)
    .values({ userId: u.id, email: 'me@acme.com', refreshTokenEnc: encrypt('rt-1') })
    .returning();

  const t0 = Date.now() - 10 * 86400_000;
  const ME = 'Ann <me@acme.com>';
  // 1) pitch with new-style link, then employer reply in the thread
  add({ id: 'm1', threadId: 't1', labelIds: ['SENT'], from: ME, to: 'abc123@job.craigslist.org', subject: 'Office Admin Needed', body: 'Hi! We can help.\nhttps://www.craigslist.org/view/d/miami-office-admin/aGt1BjYijwPMoW5gNhiWek', at: t0 });
  add({ id: 'm2', threadId: 't1', labelIds: ['INBOX'], from: 'Owner <owner@biz.com>', to: 'me@acme.com', subject: 'Re: Office Admin Needed', snippet: 'Sounds great, call me', at: t0 + 3600_000 });
  // 2) pitch with old-style link
  add({ id: 'm3', threadId: 't3', labelIds: ['SENT'], from: ME, to: 'def456@job.craigslist.org', subject: 'Receptionist', body: 'see https://miami.craigslist.org/mdc/ofc/d/miami-receptionist/7978142457.html', at: t0 + 1000 });
  // 3) subject-only match
  add({ id: 'm4', threadId: 't4', labelIds: ['SENT'], from: ME, to: 'ghi789@job.craigslist.org', subject: 'Marketing Coordinator - Brickell', body: 'Hello', at: t0 + 2000 });
  // 4) unmatched pitch to Craigslist
  add({ id: 'm5', threadId: 't5', labelIds: ['SENT'], from: ME, to: 'zzz@job.craigslist.org', subject: 'Some other job', body: 'Hi', at: t0 + 3000 });
  add({ id: 'm5r', threadId: 't5', labelIds: ['INBOX'], from: 'boss@other.com', to: 'me@acme.com', subject: 'Re: Some other job', snippet: 'Who is this?', at: t0 + 4000 });
  // 5) unrelated sent mail — must not be stored
  add({ id: 'm6', threadId: 't6', labelIds: ['SENT'], from: ME, to: 'friend@gmail.com', subject: 'Lunch?', body: 'tacos', at: t0 + 5000 });

  // --- backfill
  let r = await syncAccount(acc.id, { force: true });
  assert.ok(r.ok && !r.skipped, r.error ?? 'skipped');
  assert.equal(refreshCalls, 1, 'refreshes access token');
  const stored = await db.select().from(emailMessages);
  const get = (id: string) => stored.find((s) => s.gmailId === id);
  assert.equal(get('m1')?.matchedBy, 'link');
  assert.equal(get('m2')?.matchedBy, 'thread');
  assert.equal(get('m2')?.direction, 'received');
  assert.equal(get('m3')?.matchedBy, 'link', 'old-style post id link');
  assert.equal(get('m4')?.matchedBy, 'subject');
  assert.equal(get('m5')?.listingId, null, 'unmatched pitch stored for review');
  assert.equal(get('m5r'), undefined, 'reply in unmatched thread not stored yet');
  assert.equal(get('m6'), undefined, 'unrelated mail never stored');

  const lst = async (id: number) => (await db.select().from(listings).where(eq(listings.id, id)))[0];
  const l1 = await lst(byLink.id);
  assert.equal(l1.stage, 'replied');
  assert.equal(l1.ownerId, u.id, 'pitcher becomes the user');
  assert.equal(l1.relayEmail, 'abc123@job.craigslist.org');
  assert.equal((await lst(byOldLink.id)).stage, 'pitched');
  assert.equal((await lst(bySubject.id)).stage, 'pitched');
  const acts1 = await db.select().from(activities).where(eq(activities.listingId, byLink.id));
  assert.equal(acts1.filter((a) => a.type === 'pitch').length, 1);
  assert.equal(acts1.filter((a) => a.type === 'reply').length, 1);
  assert.equal(acts1.find((a) => a.type === 'pitch')!.at.getTime(), t0, 'activity dated at the email time');

  // --- re-run without new mail: no duplicates (force bypasses the 5-min gap)
  r = await syncAccount(acc.id, { force: true });
  assert.ok(r.ok && !r.skipped, 'forced re-sync runs');
  assert.ok((await syncAccount(acc.id)).skipped, 'unforced sync within 5 min is skipped');
  assert.equal((await db.select().from(emailMessages)).length, stored.length, 'idempotent');
  assert.equal(refreshCalls, 1, 'cached access token reused');

  // --- incremental: second reply in t1, direct pitch to contact address, unrelated inbox mail
  add({ id: 'm7', threadId: 't1', labelIds: ['INBOX'], from: 'owner@biz.com', to: 'me@acme.com', subject: 'Re: Office Admin Needed', snippet: 'Tuesday works', at: Date.now() - 60_000 }, true);
  add({ id: 'm8', threadId: 't8', labelIds: ['SENT'], from: ME, to: 'hiring@smallbiz.com', subject: 'Bookkeeping help', body: 'Hi', at: Date.now() - 50_000 }, true);
  add({ id: 'm9', threadId: 't9', labelIds: ['INBOX'], from: 'news@shop.com', to: 'me@acme.com', subject: 'Sale!', at: Date.now() - 40_000 }, true);
  add({ id: 'm10', threadId: 't8', labelIds: ['INBOX'], from: 'hiring@smallbiz.com', to: 'me@acme.com', subject: 'Re: Bookkeeping help', snippet: 'Send pricing', at: Date.now() - 30_000 }, true);
  r = await syncAccount(acc.id, { force: true });
  assert.ok(r.ok && !r.skipped, r.error ?? 'skipped');
  const stored2 = await db.select().from(emailMessages);
  const g2 = (id: string) => stored2.find((s) => s.gmailId === id);
  assert.equal(g2('m7')?.matchedBy, 'thread');
  assert.equal(g2('m8')?.matchedBy, 'contact', 'direct email to address found in the posting');
  assert.equal(g2('m9'), undefined, 'newsletter ignored');
  assert.equal(g2('m10')?.matchedBy, 'thread');
  assert.equal((await lst(byContact.id)).stage, 'replied');

  // --- manual link of the unmatched pitch pulls its thread replies
  const unmatched = g2('m5')!;
  await linkMessage(unmatched.id, byOldLink.id);
  const m5r = (await db.select().from(emailMessages).where(and(eq(emailMessages.accountId, acc.id), eq(emailMessages.gmailId, 'm5r'))))[0];
  assert.equal(m5r?.listingId, byOldLink.id, 'thread reply picked up after manual link');
  assert.equal((await lst(byOldLink.id)).stage, 'replied');

  // --- expired history cursor → rescan without duplicates
  historyExpired = true;
  const before = (await db.select().from(activities)).length;
  r = await syncAccount(acc.id, { force: true });
  assert.ok(r.ok && !r.skipped, r.error ?? 'skipped');
  assert.equal((await db.select().from(activities)).length, before, 'rescan adds no duplicate activities');
  historyExpired = false;

  // --- revoked access
  await db.update(gmailAccounts).set({ accessTokenExpiresAt: new Date(0) }).where(eq(gmailAccounts.id, acc.id));
  refreshFails = true;
  r = await syncAccount(acc.id, { force: true });
  assert.equal(r.ok, false);
  const [a2] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.id, acc.id));
  assert.match(a2.lastError ?? '', /reconnect Gmail/);

  console.log('gmail sync: all assertions passed');
}

main()
  .then(() => {
    rmSync(dir, { recursive: true, force: true });
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  });
