import { eq } from 'drizzle-orm';
import { disconnectGmail, syncMyGmail } from '@/app/gmail-actions';
import { getDb } from '@/db';
import { gmailAccounts } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { ago } from '@/lib/format';
import { gmailConfigured, workspaceDomains } from '@/lib/gmail/google';
import { BACKFILL_DAYS } from '@/lib/gmail/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const NOTICE: Record<string, [string, string]> = {
  connected: ['ok', `Gmail connected. Importing the last ${BACKFILL_DAYS} days in the background — refresh in a minute.`],
  denied: ['err', 'Google access was cancelled.'],
  no_scope: ['err', 'Gmail access wasn’t granted — tick “Read your email” on the Google screen.'],
  wrong_domain: ['err', `Use your company Google account (${workspaceDomains().map((d) => `@${d}`).join(' or ')}).`],
  bad_state: ['err', 'The sign-in link expired. Try again.'],
  error: ['err', 'Couldn’t connect to Google. Try again.'],
  not_configured: ['err', 'Gmail isn’t set up yet — an admin needs to add the Google credentials.'],
};

export default async function Settings({ searchParams }: PageProps<'/settings'>) {
  const user = await requireUser();
  const { gmail } = await searchParams;
  const db = await getDb();
  const [acc] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.userId, user.id));
  const notice = typeof gmail === 'string' ? NOTICE[gmail] : undefined;

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <div className="card space-y-3">
        <h2 className="text-sm font-semibold">Gmail</h2>
        <p className="text-sm text-zinc-500">
          Connect your company Gmail so the CRM logs your pitches to Craigslist listings and the replies you get —
          no manual logging. Access is read-only, and only emails about listings are saved (the last {BACKFILL_DAYS}{' '}
          days, then new ones every few minutes).
        </p>
        {notice && (
          <p className={`rounded-md px-3 py-2 text-sm ${notice[0] === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
            {notice[1]}
          </p>
        )}

        {!gmailConfigured() ? (
          <p className="text-sm text-amber-700">Gmail isn’t set up yet — an admin needs to add the Google credentials.</p>
        ) : acc ? (
          <div className="space-y-3">
            <div className="text-sm">
              Connected as <span className="font-medium">{acc.email}</span>
              <div className="text-xs text-zinc-500">
                {acc.backfillDone ? `Last checked ${ago(acc.lastSyncAt)}` : 'Importing past emails…'}
              </div>
              {acc.lastError && <div className="mt-1 text-xs text-red-600">{acc.lastError}</div>}
            </div>
            <div className="flex gap-2">
              <form action={syncMyGmail}>
                <button className="btn">Sync now</button>
              </form>
              <a href="/api/gmail/connect" className="btn">
                Reconnect
              </a>
              <form action={disconnectGmail}>
                <button className="btn text-red-600">Disconnect</button>
              </form>
            </div>
          </div>
        ) : (
          <a href="/api/gmail/connect" className="btn btn-primary">
            Connect Gmail
          </a>
        )}
      </div>
    </div>
  );
}
