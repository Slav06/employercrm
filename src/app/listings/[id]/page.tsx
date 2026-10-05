import { asc, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { addNote, logPitch, logReply, setFollowUp, setOwner, setStage, updateContact } from '@/app/actions';
import { StageBadge } from '@/components/stage-badge';
import { getDb } from '@/db';
import { requireUser } from '@/lib/auth';
import { activities, CHANNELS, listings, STAGES, users, type Activity } from '@/db/schema';
import { AREAS, CATEGORIES } from '@/db/seed';
import { CHANNEL_LABEL, fmtDate, STAGE_LABEL } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ListingPage({ params }: PageProps<'/listings/[id]'>) {
  await requireUser();
  const { id } = await params;
  const listingId = Number(id);
  if (!Number.isInteger(listingId)) notFound();

  const db = await getDb();
  const [l] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!l) notFound();
  const people = await db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name));
  const ownerName = people.find((p) => p.id === l.ownerId)?.name;
  const timeline = await db
    .select({ a: activities, by: users.name })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.userId))
    .where(eq(activities.listingId, listingId))
    .orderBy(desc(activities.at));

  const expired = l.validThrough && l.validThrough < new Date();
  const followUp = l.nextFollowUpAt ? l.nextFollowUpAt.toLocaleDateString('en-CA') : '';

  return (
    <div className="space-y-4">
      <Link href="/listings" className="text-sm text-zinc-500 hover:underline">
        ← Inbox
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">
            {l.title} <span className="text-sm font-normal text-zinc-400">#{l.id}</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600">
            <StageBadge stage={l.stage} />
            <span className="font-medium text-zinc-900">{l.company ?? 'Company not listed'}</span>
            {ownerName && <span>· {ownerName}</span>}
            {l.relayEmail && <span className="text-xs text-zinc-400">· {l.relayEmail}</span>}
            <span>
              {[l.city, l.region, l.postalCode].filter(Boolean).join(', ') || l.location}
            </span>
            <span className="text-zinc-400">
              {l.area && AREAS[l.area]} · {l.category && CATEGORIES[l.category]}
            </span>
          </div>
        </div>
        <a href={l.url} target="_blank" rel="noreferrer" className="btn btn-primary">
          Open on Craigslist ↗
        </a>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <div className="card grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Field label="Pay" value={l.compensation} />
            <Field label="Type" value={l.employmentType} />
            <Field label="Posted" value={fmtDate(l.postedAt, true)} />
            <Field label="Expires" value={l.validThrough ? `${fmtDate(l.validThrough)}${expired ? ' (expired)' : ''}` : null} />
            {l.repostCount > 0 && <Field label="Reposted" value={`${l.repostCount}×`} />}
            <Field label="Job title" value={l.jobTitle} />
          </div>

          <div className="card">
            <h2 className="mb-2 text-sm font-semibold">Posting</h2>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">{l.body ?? '—'}</div>
          </div>

          <div className="card">
            <h2 className="mb-3 text-sm font-semibold">Timeline</h2>
            <form action={addNote} className="mb-4 flex gap-2">
              <input type="hidden" name="id" value={l.id} />
              <input name="summary" placeholder="Add a note…" className="input" />
              <button className="btn">Add</button>
            </form>
            {timeline.length === 0 ? (
              <p className="text-sm text-zinc-500">No activity yet.</p>
            ) : (
              <ol className="space-y-3">
                {timeline.map(({ a, by }) => (
                  <TimelineItem key={a.id} a={a} by={by} />
                ))}
              </ol>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <form action={logPitch} className="card space-y-2">
            <h2 className="text-sm font-semibold">Log pitch</h2>
            <p className="text-xs text-zinc-500">
              Reply through Craigslist (the button above shows their email after a CAPTCHA), then log it here.
            </p>
            <input type="hidden" name="id" value={l.id} />
            <div className="grid grid-cols-2 gap-2">
              <ChannelSelect defaultValue="cl_reply" />
              <select name="followUpDays" defaultValue="3" className="input">
                <option value="0">No follow-up</option>
                <option value="2">Follow up in 2d</option>
                <option value="3">Follow up in 3d</option>
                <option value="5">Follow up in 5d</option>
                <option value="7">Follow up in 7d</option>
              </select>
            </div>
            <input name="to" placeholder="Sent to (email / phone)" className="input" />
            <textarea name="summary" rows={3} placeholder="What we pitched…" className="input" />
            <button className="btn btn-primary w-full">Log pitch</button>
          </form>

          <form action={logReply} className="card space-y-2">
            <h2 className="text-sm font-semibold">Log reply</h2>
            <input type="hidden" name="id" value={l.id} />
            <div className="grid grid-cols-2 gap-2">
              <ChannelSelect defaultValue="email" />
              <input name="from" placeholder="From" className="input" />
            </div>
            <textarea name="summary" rows={3} placeholder="What they said…" className="input" />
            <button className="btn w-full">Log reply</button>
          </form>

          <div className="card space-y-3">
            <form action={setStage} className="flex items-end gap-2">
              <input type="hidden" name="id" value={l.id} />
              <div className="flex-1">
                <label className="label">Stage</label>
                <select name="stage" defaultValue={l.stage} className="input">
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn">Set</button>
            </form>
            <form action={setOwner} className="flex items-end gap-2">
              <input type="hidden" name="id" value={l.id} />
              <div className="flex-1">
                <label className="label">User</label>
                <select name="ownerId" defaultValue={l.ownerId ?? 0} className="input">
                  <option value={0}>Unassigned</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn">Set</button>
            </form>
            <form action={setFollowUp} className="flex items-end gap-2">
              <input type="hidden" name="id" value={l.id} />
              <div className="flex-1">
                <label className="label">Next follow-up</label>
                <input type="date" name="date" defaultValue={followUp} className="input" />
              </div>
              <button className="btn">Save</button>
            </form>
          </div>

          <form action={updateContact} className="card space-y-2">
            <h2 className="text-sm font-semibold">Business & contact</h2>
            <input type="hidden" name="id" value={l.id} />
            <input name="company" defaultValue={l.company ?? ''} placeholder="Company" className="input" />
            <input name="contactName" defaultValue={l.contactName ?? ''} placeholder="Contact name" className="input" />
            <input name="contactEmail" defaultValue={l.contactEmail ?? ''} placeholder="Email" className="input" />
            <input name="contactPhone" defaultValue={l.contactPhone ?? ''} placeholder="Phone" className="input" />
            <input name="website" defaultValue={l.website ?? ''} placeholder="Website" className="input" />
            <textarea name="notes" defaultValue={l.notes ?? ''} rows={2} placeholder="Notes" className="input" />
            <button className="btn w-full">Save</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="truncate" title={value ?? ''}>
        {value || '—'}
      </div>
    </div>
  );
}

function ChannelSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <select name="channel" defaultValue={defaultValue} className="input">
      {CHANNELS.map((c) => (
        <option key={c} value={c}>
          {CHANNEL_LABEL[c]}
        </option>
      ))}
    </select>
  );
}

const TYPE_STYLE: Record<string, string> = {
  pitch: 'bg-amber-500',
  reply: 'bg-emerald-500',
  note: 'bg-zinc-400',
  stage: 'bg-indigo-400',
  follow_up: 'bg-sky-400',
};

function TimelineItem({ a, by }: { a: Activity; by: string | null }) {
  const meta = (a.meta ?? {}) as Record<string, string | null>;
  let title: string;
  if (a.type === 'pitch') title = `Pitched via ${CHANNEL_LABEL[a.channel ?? ''] ?? a.channel}${meta.to ? ` → ${meta.to}` : ''}`;
  else if (a.type === 'reply') title = `Reply via ${CHANNEL_LABEL[a.channel ?? ''] ?? a.channel}${meta.from ? ` from ${meta.from}` : ''}`;
  else if (a.type === 'stage') title = `Stage: ${STAGE_LABEL[meta.from as never] ?? meta.from} → ${STAGE_LABEL[meta.to as never] ?? meta.to}`;
  else if (a.type === 'follow_up') title = 'Follow-up scheduled';
  else title = 'Note';

  return (
    <li className="flex gap-3 text-sm">
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${TYPE_STYLE[a.type]}`} />
      <div className="min-w-0">
        <div>
          <span className="font-medium">{title}</span>{' '}
          <span className="text-xs text-zinc-400">
            {fmtDate(a.at, true)}
            {by && ` · ${by}`}
            {meta.gmail && ' · from Gmail'}
          </span>
        </div>
        {a.summary && <div className="whitespace-pre-wrap text-zinc-600">{a.summary}</div>}
      </div>
    </li>
  );
}
