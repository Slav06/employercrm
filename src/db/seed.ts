import { count } from 'drizzle-orm';
import type { DB } from './index';
import { searches } from './schema';

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
