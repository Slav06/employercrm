import { asc, desc } from 'drizzle-orm';
import { deleteTemplate, saveTemplate } from '@/app/actions';
import { getDb } from '@/db';
import { requireUser } from '@/lib/auth';
import { emailTemplates, type EmailTemplate } from '@/db/schema';
import { CATEGORIES } from '@/db/seed';

export const dynamic = 'force-dynamic';

export default async function Templates() {
  await requireUser();
  const db = await getDb();
  const rows = await db.select().from(emailTemplates).orderBy(asc(emailTemplates.category), desc(emailTemplates.updatedAt));

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Email templates</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Templates show up in the <b>Send email</b> box on a lead. A template tied to a category only appears on leads in
          that category; “Any category” shows everywhere. Placeholders get filled from the lead:{' '}
          <code>{'{{company}}'}</code> <code>{'{{job}}'}</code> <code>{'{{title}}'}</code> <code>{'{{city}}'}</code>{' '}
          <code>{'{{me}}'}</code> (your name).
        </p>
      </div>

      {rows.map((t) => (
        <TemplateForm key={t.id} template={t} />
      ))}

      <div className="card space-y-1">
        <h2 className="text-sm font-semibold">New template</h2>
        <TemplateForm />
      </div>
    </div>
  );
}

function TemplateForm({ template }: { template?: EmailTemplate }) {
  const t = template;
  return (
    <form action={saveTemplate} className={t ? 'card space-y-3' : 'space-y-3'}>
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="flex flex-wrap gap-3">
        <div className="min-w-48 flex-1">
          <label className="label">Name</label>
          <input name="name" defaultValue={t?.name ?? ''} placeholder="e.g. Admin / Office pitch" required className="input" />
        </div>
        <div>
          <label className="label">Category</label>
          <select name="category" defaultValue={t?.category ?? ''} className="input">
            <option value="">Any category</option>
            {Object.entries(CATEGORIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Subject</label>
        <input name="subject" defaultValue={t?.subject ?? ''} placeholder="Your {{job}} opening at {{company}}" className="input" />
      </div>
      <div>
        <label className="label">Body</label>
        <textarea name="body" defaultValue={t?.body ?? ''} rows={7} placeholder="Hi {{company}} team, …" className="input font-sans" />
      </div>
      <div className="flex items-center gap-2">
        <button className="btn btn-primary">{t ? 'Save' : 'Add template'}</button>
        {t && (
          <button formAction={deleteTemplate} className="btn text-red-600">
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
