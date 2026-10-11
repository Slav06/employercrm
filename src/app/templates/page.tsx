import { asc, desc } from 'drizzle-orm';
import { getDb } from '@/db';
import { requireUser } from '@/lib/auth';
import { emailTemplates } from '@/db/schema';
import { CATEGORIES } from '@/db/seed';
import { TemplatesManager } from './templates-manager';

export const dynamic = 'force-dynamic';

export default async function Templates() {
  await requireUser();
  const db = await getDb();
  const rows = await db.select().from(emailTemplates).orderBy(asc(emailTemplates.name), desc(emailTemplates.updatedAt));

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Email templates</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Pick a category to see its templates. They show up in the <b>Send email</b> box on a lead — a category template
          only on leads in that category, “Any category” everywhere. Placeholders fill from the lead:{' '}
          <code>{'{{company}}'}</code> <code>{'{{job}}'}</code> <code>{'{{title}}'}</code> <code>{'{{city}}'}</code>{' '}
          <code>{'{{me}}'}</code> (your name).
        </p>
      </div>

      <TemplatesManager templates={rows} categories={Object.entries(CATEGORIES)} />
    </div>
  );
}
