import { and, asc, desc, eq, sql } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { addNote, logPitch, logReply, researchCompany, setFollowUp, setOwner, setStage, updateContact } from '@/app/actions';
import { sendEmail } from '@/app/gmail-actions';
import { StageBadge } from '@/components/stage-badge';
import { getDb } from '@/db';
import { requireUser } from '@/lib/auth';
import { activities, CHANNELS, companies, emailMessages, gmailAccounts, listings, STAGES, users, type Activity, type Company } from '@/db/schema';
import { AREAS, CATEGORIES } from '@/db/seed';
import { enrichConfigured } from '@/lib/enrich';
import { gmailConfigured } from '@/lib/gmail/google';
import { CHANNEL_LABEL, fmtDate, STAGE_LABEL } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ListingPage({ params }: PageProps<'/listings/[id]'>) {
  const user = await requireUser();
  const { id } = await params;
  const listingId = Number(id);
  if (!Number.isInteger(listingId)) notFound();

  const db = await getDb();
  const [l] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!l) notFound();
  const people = await db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name));
  const ownerName = people.find((p) => p.id === l.ownerId)?.name;
  const [companyInfo] = l.company
    ? await db.select().from(companies).where(sql`lower(${companies.name}) = lower(${l.company})`)
    : [];

  // Email composer state: does the signed-in user have Gmail connected, and is there already
  // a thread for this lead in their mailbox (so the composer acts as a reply)?
  const [myGmail] = await db.select({ email: gmailAccounts.email }).from(gmailAccounts).where(eq(gmailAccounts.userId, user.id));
  const [lastMine] = myGmail
    ? await db
        .select({ at: emailMessages.at, fromAddr: emailMessages.fromAddr, direction: emailMessages.direction })
        .from(emailMessages)
        .where(and(eq(emailMessages.userId, user.id), eq(emailMessages.listingId, listingId)))
        .orderBy(desc(emailMessages.at))
        .limit(1)
    : [];
  const sendTo = l.relayEmail ?? l.contactEmail ?? (lastMine?.direction === 'received' ? lastMine.fromAddr : null) ?? '';
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

          <CompanyResearch listing={l} info={companyInfo} />

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
          <EmailComposer
            listingId={l.id}
            configured={gmailConfigured()}
            fromEmail={myGmail?.email}
            to={sendTo}
            subject={l.title}
            threaded={Boolean(lastMine)}
          />

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

function CompanyResearch({ listing, info }: { listing: { id: number; company: string | null }; info: Company | undefined }) {
  const employees = info?.employeeCount ? info.employeeCount.toLocaleString() : info?.sizeRange;
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Company research</h2>
        {listing.company && (enrichConfigured() || info) && (
          <form action={researchCompany}>
            <input type="hidden" name="id" value={listing.id} />
            {info && <input type="hidden" name="refresh" value="1" />}
            <button className="btn text-xs">{info ? 'Refresh' : 'Research'}</button>
          </form>
        )}
      </div>

      {!listing.company ? (
        <p className="text-sm text-zinc-500">No company name on this listing.</p>
      ) : !info && !enrichConfigured() ? (
        <p className="text-sm text-zinc-500">Enrichment isn’t set up yet — add a PDL_API_KEY to turn it on.</p>
      ) : !info ? (
        <p className="text-sm text-zinc-500">Not researched yet — click Research to look up {listing.company}.</p>
      ) : info.status === 'not_found' ? (
        <p className="text-sm text-zinc-500">No match found for “{listing.company}”. Common for very small or new businesses.</p>
      ) : info.status === 'error' ? (
        <p className="text-sm text-amber-700">Lookup failed — check the API key/credits and try Refresh.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
            <Field label="Industry" value={info.industry} />
            <Field label="Employees" value={employees} />
            <Field label="Revenue" value={info.revenue} />
            <Field label="Founded" value={info.foundedYear ? String(info.foundedYear) : null} />
            <Field label="Location" value={info.location} />
            <div className="min-w-0">
              <div className="text-xs text-zinc-500">Links</div>
              <div className="flex gap-3 truncate">
                {info.website ? (
                  <a href={withProtocol(info.website)} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                    Website ↗
                  </a>
                ) : null}
                {info.linkedinUrl ? (
                  <a href={withProtocol(info.linkedinUrl)} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                    LinkedIn ↗
                  </a>
                ) : null}
                {!info.website && !info.linkedinUrl && '—'}
              </div>
            </div>
          </div>
          <p className="text-xs text-zinc-400">
            {info.displayName && info.displayName !== listing.company ? `Matched “${info.displayName}” · ` : ''}via People Data Labs · {fmtDate(info.fetchedAt, true)}
          </p>
        </>
      )}
    </div>
  );
}

const withProtocol = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

function EmailComposer({
  listingId,
  configured,
  fromEmail,
  to,
  subject,
  threaded,
}: {
  listingId: number;
  configured: boolean;
  fromEmail: string | undefined;
  to: string;
  subject: string;
  threaded: boolean;
}) {
  return (
    <form action={sendEmail} className="card space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{threaded ? 'Reply by email' : 'Send email'}</h2>
        {fromEmail && <span className="truncate text-xs text-zinc-400">from {fromEmail}</span>}
      </div>
      {!configured ? (
        <p className="text-sm text-zinc-500">Email sending isn’t set up on this workspace yet.</p>
      ) : !fromEmail ? (
        <p className="text-sm text-zinc-500">
          Connect your Gmail in{' '}
          <Link href="/settings" className="text-indigo-600 hover:underline">
            Settings
          </Link>{' '}
          to send from the CRM.
        </p>
      ) : (
        <>
          <input type="hidden" name="id" value={listingId} />
          <input name="to" defaultValue={to} placeholder="Recipient email" required className="input" />
          <input name="subject" defaultValue={subject} placeholder="Subject" className="input" />
          <textarea name="body" rows={5} placeholder="Write your message…" required className="input" />
          <p className="text-xs text-zinc-500">
            {threaded ? 'Continues the existing email thread. ' : ''}Goes out from your Gmail and is logged as a pitch here.
          </p>
          <button className="btn btn-primary w-full">{threaded ? 'Send reply' : 'Send email'}</button>
        </>
      )}
    </form>
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
