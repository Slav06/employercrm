import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import Link from 'next/link';
import { setStage } from '@/app/actions';
import { StageBadge } from '@/components/stage-badge';
import { getDb } from '@/db';
import { requireUser } from '@/lib/auth';
import { listings, STAGES } from '@/db/schema';
import { AREAS, CATEGORIES } from '@/db/seed';
import { ago, isStage, STAGE_LABEL } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

export default async function Inbox({ searchParams }: PageProps<'/listings'>) {
  await requireUser();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const stage = one('stage') || 'new';
  const area = one('area');
  const category = one('category');
  const q = one('q');

  const where: SQL[] = [];
  if (stage !== 'all' && isStage(stage)) where.push(eq(listings.stage, stage));
  if (area) where.push(eq(listings.area, area));
  if (category) where.push(eq(listings.category, category));
  if (q) {
    const like = `%${q}%`;
    where.push(or(ilike(listings.title, like), ilike(listings.company, like), ilike(listings.body, like))!);
  }

  const db = await getDb();
  const rows = await db
    .select()
    .from(listings)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(sql`coalesce(${listings.postedAt}, ${listings.firstSeenAt})`))
    .limit(PAGE_SIZE);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Inbox</h1>

      <form className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Stage</label>
          <select name="stage" defaultValue={stage} className="input">
            <option value="all">All</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">City</label>
          <select name="area" defaultValue={area} className="input">
            <option value="">All</option>
            {Object.entries(AREAS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Category</label>
          <select name="category" defaultValue={category} className="input">
            <option value="">All</option>
            {Object.entries(CATEGORIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-48 flex-1">
          <label className="label">Search</label>
          <input name="q" defaultValue={q} placeholder="title, company, description…" className="input" />
        </div>
        <button className="btn">Filter</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Listing</th>
              <th className="px-2 py-2 font-medium">Where</th>
              <th className="px-2 py-2 font-medium">Pay</th>
              <th className="px-2 py-2 font-medium">Posted</th>
              <th className="px-2 py-2 font-medium">Stage</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((l) => (
              <tr key={l.id} className="hover:bg-zinc-50">
                <td className="max-w-md px-4 py-2">
                  <Link href={`/listings/${l.id}`} className="block truncate font-medium hover:underline">
                    {l.title}
                  </Link>
                  <div className="truncate text-xs text-zinc-500">
                    {l.company ?? 'Company not listed'}
                    {l.repostCount > 0 && <span className="ml-2 text-amber-700">reposted ×{l.repostCount}</span>}
                  </div>
                </td>
                <td className="px-2 py-2 text-zinc-600">
                  <div className="truncate">{l.city ?? l.location}</div>
                  <div className="text-xs text-zinc-400">{l.area && AREAS[l.area]}</div>
                </td>
                <td className="max-w-40 truncate px-2 py-2 text-zinc-600" title={l.compensation ?? ''}>
                  {l.compensation ?? '—'}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-zinc-500">{ago(l.postedAt ?? l.firstSeenAt)}</td>
                <td className="px-2 py-2">
                  <StageBadge stage={l.stage} />
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right">
                  {l.stage === 'new' && (
                    <span className="inline-flex gap-1">
                      <form action={setStage}>
                        <input type="hidden" name="id" value={l.id} />
                        <input type="hidden" name="stage" value="qualified" />
                        <button className="btn py-1 text-xs">Qualify</button>
                      </form>
                      <form action={setStage}>
                        <input type="hidden" name="id" value={l.id} />
                        <input type="hidden" name="stage" value="skipped" />
                        <button className="btn py-1 text-xs text-zinc-500">Skip</button>
                      </form>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  No listings match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length === PAGE_SIZE && <p className="text-xs text-zinc-500">Showing the newest {PAGE_SIZE}. Narrow the filters to see more.</p>}
    </div>
  );
}
