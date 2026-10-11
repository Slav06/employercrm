import { count } from 'drizzle-orm';
import type { DB } from './index';
import { emailTemplates, searches } from './schema';

export const AREAS: Record<string, string> = {
  miami: 'Miami / South FL',
  newyork: 'New York',
  sfbay: 'SF Bay Area',
};

export const CATEGORIES: Record<string, string> = {
  ofc: 'Admin / Office',
  mar: 'Marketing / PR',
  jjj: 'All jobs',
};

// Starting searches: office admin + marketing in Miami, New York, SF. Only seeded
// into an empty table so edits made in the app stick.
export async function seedSearches(db: DB) {
  const [{ n }] = await db.select({ n: count() }).from(searches);
  if (n > 0) return;
  const rows = [];
  for (const area of ['miami', 'newyork', 'sfbay']) {
    for (const category of ['ofc', 'mar']) {
      rows.push({ name: `${AREAS[area]} — ${CATEGORIES[category]}`, area, category });
    }
  }
  await db.insert(searches).values(rows);
}

// Starter pitch templates, one per category, only seeded into an empty table so team
// edits stick. Placeholders: {{company}} {{job}} {{title}} {{city}} {{me}}.
export async function seedTemplates(db: DB) {
  const [{ n }] = await db.select({ n: count() }).from(emailTemplates);
  if (n > 0) return;
  await db.insert(emailTemplates).values([
    {
      name: 'Admin / Office pitch',
      category: 'ofc',
      subject: 'Your {{job}} opening at {{company}}',
      body:
        'Hi {{company}} team,\n\n' +
        'I saw your {{job}} posting and wanted to reach out. We help {{city}} businesses fill admin and office roles quickly with pre-screened candidates.\n\n' +
        'Would you be open to a quick call this week?\n\nBest,\n{{me}}',
    },
    {
      name: 'Marketing / PR pitch',
      category: 'mar',
      subject: 'Helping {{company}} hire for {{job}}',
      body:
        'Hi {{company}} team,\n\n' +
        'Your {{job}} listing caught my eye. We place marketing and PR talent for {{city}} companies and could line up strong candidates for this role.\n\n' +
        'Open to a short chat?\n\nThanks,\n{{me}}',
    },
    {
      name: 'General pitch',
      category: '',
      subject: 'Re: {{title}}',
      body:
        'Hi {{company}} team,\n\n' +
        'I came across your {{job}} posting. We help {{city}} employers hire faster with vetted candidates, and I think we could help here.\n\n' +
        'Would a quick call this week work?\n\nBest,\n{{me}}',
    },
  ]);
}
