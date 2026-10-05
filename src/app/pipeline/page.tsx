import { and, desc, gte, inArray, or } from 'drizzle-orm';
import Link from 'next/link';
import { getDb } from '@/db';
import { requireUser } from '@/lib/auth';
import { listings, type Stage } from '@/db/schema';
import { AREAS } from '@/db/seed';
import { daysAgo, fmtDate, STAGE_CLASS, STAGE_LABEL } from '@/lib/format';

export const dynamic = 'force-dynamic';

// Board shows everything we've engaged with; "new" and "skipped" live in the Inbox.
const COLUMNS: Stage[] = ['qualified', 'pitched', 'replied', 'meeting', 'proposal', 'won', 'lost'];

export default async function Pipeline() {
  await requireUser();
  const db = await getDb();
  const monthAgo = daysAgo(30);
  const rows = await db
    .select()
    .from(listings)
    .where(
      and(
        inArray(listings.stage, COLUMNS),
        // Keep closed columns from growing forever.
        or(inArray(listings.stage, COLUMNS.slice(0, 5)), gte(listings.updatedAt, monthAgo)),
      ),
    )
    .orderBy(desc(listings.updatedAt));

  const now = new Date();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Pipeline</h1>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((stage) => {
          const items = rows.filter((r) => r.stage === stage);
          return (
            <section key={stage} className="w-64 shrink-0">
              <h2 className="mb-2 flex items-center justify-between text-sm font-semibold">
                <span className={`rounded-full px-2 py-0.5 text-xs ${STAGE_CLASS[stage]}`}>{STAGE_LABEL[stage]}</span>
                <span className="text-zinc-400 tabular-nums">{items.length}</span>
              </h2>
              <div className="space-y-2">
                {items.map((l) => (
                  <Link key={l.id} href={`/listings/${l.id}`} className="card block p-3 text-sm hover:border-zinc-400">
                    <div className="truncate font-medium">{l.company ?? l.title}</div>
                    {l.company && <div className="truncate text-xs text-zinc-500">{l.title}</div>}
                    <div className="mt-1 flex justify-between text-xs text-zinc-400">
                      <span>{l.area && AREAS[l.area]}</span>
                      {l.nextFollowUpAt && (
                        <span className={l.nextFollowUpAt < now ? 'text-red-600' : ''}>↻ {fmtDate(l.nextFollowUpAt)}</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
