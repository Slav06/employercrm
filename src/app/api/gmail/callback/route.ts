import { eq } from 'drizzle-orm';
import { after, NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db';
import { gmailAccounts } from '@/db/schema';
import { getUser } from '@/lib/auth';
import { encrypt } from '@/lib/gmail/crypto';
import { allowedEmail, exchangeCode, GMAIL_SCOPE, idTokenClaims, STATE_COOKIE } from '@/lib/gmail/google';
import { syncAccount } from '@/lib/gmail/sync';

export const maxDuration = 300; // first sync (60-day backfill) runs after the redirect

export async function GET(req: NextRequest) {
  const back = (status: string) => {
    const res = NextResponse.redirect(new URL(`/settings?gmail=${status}`, req.url));
    res.cookies.delete({ name: STATE_COOKIE, path: '/api/gmail' });
    return res;
  };
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));

  const sp = req.nextUrl.searchParams;
  if (sp.get('error')) return back('denied');
  const state = sp.get('state');
  if (!state || state !== req.cookies.get(STATE_COOKIE)?.value) return back('bad_state');

  let tokens;
  try {
    tokens = await exchangeCode(sp.get('code') ?? '', `${req.nextUrl.origin}/api/gmail/callback`);
  } catch {
    return back('error');
  }
  if (!tokens.scope?.split(' ').includes(GMAIL_SCOPE)) return back('no_scope'); // user unticked Gmail access
  if (!tokens.refresh_token) return back('error');

  const { email } = idTokenClaims(tokens.id_token);
  if (!email) return back('error');
  if (!allowedEmail(email)) return back('wrong_domain');

  const db = await getDb();
  const [existing] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.userId, user.id));
  const values = {
    email: email.toLowerCase(),
    refreshTokenEnc: encrypt(tokens.refresh_token),
    accessToken: tokens.access_token,
    accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    lastError: null,
    lastSyncAt: null,
    connectedAt: new Date(),
  };
  let accountId: number;
  if (existing) {
    const changedMailbox = existing.email !== values.email;
    await db
      .update(gmailAccounts)
      .set({ ...values, ...(changedMailbox ? { historyId: null, backfillDone: false } : {}) })
      .where(eq(gmailAccounts.id, existing.id));
    accountId = existing.id;
  } else {
    const [row] = await db.insert(gmailAccounts).values({ userId: user.id, ...values }).returning({ id: gmailAccounts.id });
    accountId = row.id;
  }
  after(() => syncAccount(accountId, { force: true }));
  return back('connected');
}
