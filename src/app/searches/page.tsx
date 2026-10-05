import { asc } from 'drizzle-orm';
import { saveSearch, toggleSearch } from '@/app/actions';
import { getDb } from '@/db';
import { searches } from '@/db/schema';
import { ago } from '@/lib/format';
import { searchUrl } from '@/lib/craigslist';

export const dynamic = 'force-dynamic';

export default async function Searches() {
  const db = await getDb();
  const rows = await db.select().from(searches).orderBy(asc(searches.id));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Saved searches</h1>
      <p className="text-sm text-zinc-500">
        Each active search is checked on every fetch. Craigslist only shows the ~320 newest results per search, so
        fetch at least a few times a day. Exclude terms skip listings whose title or description contains them.
      </p>

      <div className="space-y-2">
        {rows.map((s) => (
          <div key={s.id} className={`card ${s.active ? '' : 'opacity-60'}`}>
            <form action={saveSearch} className="grid items-end gap-2 md:grid-cols-[2fr_1fr_80px_1.5fr_2fr_auto]">
              <input type="hidden" name="id" value={s.id} />
              <div>
                <label className="label">Name</label>
                <input name="name" defaultValue={s.name} className="input" />
              </div>
              <div>
                <label className="label">Area</label>
                <input name="area" defaultValue={s.area} className="input" />
              </div>
              <div>
                <label className="label">Category</label>
                <input name="category" defaultValue={s.category} className="input" />
              </div>
              <div>
                <label className="label">Keywords</label>
                <input name="query" defaultValue={s.query} className="input" />
              </div>
              <div>
                <label className="label">Exclude terms (comma separated)</label>
                <input name="excludeTerms" defaultValue={s.excludeTerms} className="input" />
              </div>
              <button className="btn">Save</button>
            </form>
            <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
              <span>
                Last run {ago(s.lastRunAt)} ·{' '}
                <a href={searchUrl(s.area, s.category, s.query)} target="_blank" rel="noreferrer" className="hover:underline">
                  view on Craigslist ↗
                </a>
              </span>
              <form action={toggleSearch}>
                <input type="hidden" name="id" value={s.id} />
                <button className="hover:underline">{s.active ? 'Pause' : 'Resume'}</button>
              </form>
            </div>
          </div>
        ))}
      </div>

      <form action={saveSearch} className="card grid items-end gap-2 md:grid-cols-[2fr_1fr_80px_1.5fr_2fr_auto]">
        <div>
          <label className="label">New search name</label>
          <input name="name" placeholder="Chicago — Admin" className="input" />
        </div>
        <div>
          <label className="label">Area</label>
          <input name="area" placeholder="chicago" required className="input" />
        </div>
        <div>
          <label className="label">Category</label>
          <input name="category" placeholder="ofc" required className="input" />
        </div>
        <div>
          <label className="label">Keywords</label>
          <input name="query" className="input" />
        </div>
        <div>
          <label className="label">Exclude terms</label>
          <input name="excludeTerms" placeholder="commission only, mlm" className="input" />
        </div>
        <button className="btn btn-primary">Add</button>
      </form>
      <p className="text-xs text-zinc-400">
        Categories: ofc admin/office · mar marketing/PR · sls sales · cpg computer gigs · jjj all jobs. Area is the
        Craigslist subdomain (miami, newyork, sfbay, losangeles, chicago…).
      </p>
    </div>
  );
}
