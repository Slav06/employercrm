import { and, count, countDistinct, desc, eq, gte, isNotNull, lte, notInArray, sql } from 'drizzle-orm';
import Link from 'next/link';
import { fetchNow } from '@/app/actions';
import { StageBadge } from '@/components/stage-badge';
import { getDb } from '@/db';
import { requireUser } from '@/lib/auth';
import { activities, fetchRuns, listings, searches, STAGES } from '@/db/schema';
import { ago, daysAgo, endOfToday, fmtDate, STAGE_LABEL } from '@/lib/format';
import { FETCH_ENABLED, isIngestRunning } from '@/lib/ingest';

export const dynamic = 'force-dynamic';

const CLOSED = ['won', 'lost', 'skipped'] as const;

export default async function Dashboard() {
  await requireUser();
  const db = await getDb();
  const dayAgo = daysAgo(1);
  const weekAgo = daysAgo(7);

  const [byStage, [newToday], [pitchedWeek], [pitchedEver], [repliedEver], due, runs] = await Promise.all([
    db.select({ stage: listings.stage, n: count() }).from(listings).groupBy(listings.stage),
    db.select({ n: count() }).from(listings).where(and(gte(listings.firstSeenAt, dayAgo), eq(listings.excluded, false))),
    db.select({ n: countDistinct(activities.listingId) }).from(activities).where(and(eq(activities.type, 'pitch'), gte(activities.at, weekAgo))),
    db.select({ n: countDistinct(activities.listingId) }).from(activities).where(eq(activities.type, 'pitch')),
    db
      .select({ n: countDistinct(activities.listingId) })
      .from(activities)
      .where(
        and(
          eq(activities.type, 'reply'),
          sql`${activities.listingId} in (select listing_id from activities where type = 'pitch')`,
        ),
      ),
    db
      .select()
      .from(listings)
      .where(and(isNotNull(listings.nextFollowUpAt), lte(listings.nextFollowUpAt, endOfToday()), notInArray(listings.stage, [...CLOSED])))
      .orderBy(listings.nextFollowUpAt)
      .limit(50),
    db
      .select({ run: fetchRuns, name: searches.name })
      .from(fetchRuns)
      .leftJoin(searches, eq(searches.id, fetchRuns.searchId))
      .orderBy(desc(fetchRuns.startedAt))
      .limit(12),
  ]);

  const stageCount = Object.fromEntries(byStage.map((r) => [r.stage, r.n])) as Record<string, number>;
  const replyRate = pitchedEver.n ? Math.round((repliedEver.n / pitchedEver.n) * 100) : null;
  const running = isIngestRunning();

  const stats = [
    { label: 'New listings (24h)', value: newToday.n, href: '/listings?stage=new' },
    { label: 'To review', value: stageCount.new ?? 0, href: '/listings?stage=new' },
    { label: 'Pitched (7 days)', value: pitchedWeek.n, href: '/listings?stage=pitched' },
    { label: 'Reply rate', value: replyRate === null ? '—' : `${replyRate}%`, sub: `${repliedEver.n} of ${pitchedEver.n} pitched` },
    { label: 'Follow-ups due', value: due.length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        {FETCH_ENABLED ? (
          <form action={fetchNow}>
            <button className="btn btn-primary" disabled={running}>
              {running ? 'Fetching… (refresh to see progress)' : 'Fetch new listings'}
            </button>
          </form>
        ) : (
          <span className="text-xs text-zinc-500">New listings are fetched from the office machine</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map((s) => {
          const body = (
            <>
              <div className="text-xs text-zinc-500">{s.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</div>
              {s.sub && <div className="text-xs text-zinc-400">{s.sub}</div>}
            </>
          );
          return s.href ? (
            <Link key={s.label} href={s.href} className="card hover:border-zinc-400">
              {body}
            </Link>
          ) : (
            <div key={s.label} className="card">
              {body}
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold">Pipeline</h2>
        <div className="flex flex-wrap gap-2">
          {STAGES.map((s) => (
            <Link key={s} href={`/listings?stage=${s}`} className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-1.5 text-sm hover:border-zinc-400">
              <StageBadge stage={s} />
              <span className="tabular-nums">{stageCount[s] ?? 0}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold">Follow-ups due today</h2>
          {due.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing due.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {due.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/listings/${l.id}`} className="min-w-0 truncate hover:underline">
                    <span className="font-medium">{l.company ?? l.title}</span>
                    {l.company && <span className="text-zinc-500"> — {l.title}</span>}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    <StageBadge stage={l.stage} />
                    <span className={l.nextFollowUpAt! < new Date() ? 'text-red-600' : 'text-zinc-500'}>{fmtDate(l.nextFollowUpAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2 className="mb-3 text-sm font-semibold">Recent fetches</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-zinc-500">No fetches yet — click “Fetch new listings”.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-zinc-100">
                {runs.map(({ run, name }) => (
                  <tr key={run.id}>
                    <td className="py-1.5 pr-2">{name ?? '—'}</td>
                    <td className="py-1.5 pr-2 text-zinc-500">{ago(run.startedAt)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {run.error ? (
                        <span className="text-red-600" title={run.error}>
                          error
                        </span>
                      ) : !run.finishedAt ? (
                        <span className="text-amber-600">running…</span>
                      ) : (
                        <span className="text-zinc-600">
                          +{run.added} new{run.reposts ? ` · ${run.reposts} reposts` : ''} · {run.found} seen
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <p className="text-xs text-zinc-400">Stages: {STAGES.map((s) => STAGE_LABEL[s]).join(' → ')}</p>
    </div>
  );
}
