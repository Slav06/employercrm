import { and, desc, eq, ilike, isNull } from 'drizzle-orm';
import Link from 'next/link';
import { dismissEmail, linkEmail } from '@/app/gmail-actions';
import { getDb } from '@/db';
import { emailMessages, listings, users } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { normalizeSubject } from '@/lib/gmail/match';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export default async function Email() {
  await requireUser();
  const db = await getDb();
  const rows = await db
    .select({ m: emailMessages, by: users.name })
    .from(emailMessages)
    .leftJoin(users, eq(users.id, emailMessages.userId))
    .where(and(isNull(emailMessages.listingId), eq(emailMessages.dismissed, false)))
    .orderBy(desc(emailMessages.at))
    .limit(100);

  // Suggest listings whose title contains the start of the subject.
  const suggestions = await Promise.all(
    rows.map(({ m }) => {
      const words = normalizeSubject(m.subject ?? '').slice(0, 30);
      if (words.length < 6) return Promise.resolve([]);
      return db
        .select({ id: listings.id, title: listings.title, area: listings.area })
        .from(listings)
        .where(ilike(listings.title, `%${words.replace(/[\\%_]/g, '\\$&')}%`))
        .orderBy(desc(listings.postedAt))
        .limit(3);
    }),
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Unmatched emails</h1>
      <p className="text-sm text-zinc-500">
        Pitches sent to Craigslist that couldn’t be matched to a listing automatically. Link each one (use the{' '}
        <span className="font-mono">#number</span> on the listing page or its Craigslist link) and its replies will be
        tracked too.
      </p>
      {rows.length === 0 && <div className="card text-sm text-zinc-500">Nothing to match. 🎉</div>}
      {rows.map(({ m, by }, i) => (
        <div key={m.id} className="card space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{m.subject || '(no subject)'}</span>
            <span className="text-xs text-zinc-500">
              {by} → {m.toAddrs} · {fmtDate(m.at, true)}
            </span>
          </div>
          {m.snippet && <p className="text-sm text-zinc-600">{m.snippet}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {suggestions[i].map((s) => (
              <form key={s.id} action={linkEmail}>
                <input type="hidden" name="messageId" value={m.id} />
                <input type="hidden" name="listing" value={s.id} />
                <button className="btn py-1 text-xs" title={s.title}>
                  Link to #{s.id} {s.title.slice(0, 40)}
                </button>
              </form>
            ))}
            <form action={linkEmail} className="flex gap-1">
              <input type="hidden" name="messageId" value={m.id} />
              <input name="listing" required placeholder="#id or Craigslist link" className="input w-56 py-1 text-xs" />
              <button className="btn py-1 text-xs">Link</button>
            </form>
            <form action={dismissEmail} className="ml-auto">
              <input type="hidden" name="messageId" value={m.id} />
              <button className="text-xs text-zinc-500 hover:underline">Not a listing</button>
            </form>
          </div>
        </div>
      ))}
      <p className="text-xs text-zinc-400">
        Tip: the listing number is in its address bar, e.g. /listings/<b>42</b>. <Link href="/listings">Back to Inbox</Link>
      </p>
    </div>
  );
}
