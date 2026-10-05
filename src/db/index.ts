import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from './schema';
import { seedSearches } from './seed';

// DATABASE_URL set → real Postgres (Neon). Unset → embedded PGlite in ./data/pglite.
// PGlite is single-process: while the dev server runs, trigger fetches through the
// app (button or POST /api/fetch), not `npm run fetch`.
export type DB = PgliteDatabase<typeof schema>;

const g = globalThis as unknown as { __db?: Promise<DB> };

async function init(): Promise<DB> {
  const migrationsFolder = path.join(process.cwd(), 'drizzle');
  let db: DB;

  if (process.env.DATABASE_URL) {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    const pgdb = drizzle(process.env.DATABASE_URL, { schema });
    await migrate(pgdb, { migrationsFolder });
    db = pgdb as unknown as DB;
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const dir = path.join(process.cwd(), 'data', 'pglite');
    mkdirSync(path.dirname(dir), { recursive: true });
    const client = new PGlite(dir);
    db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder });
  }

  await seedSearches(db);
  return db;
}

export function getDb(): Promise<DB> {
  g.__db ??= init().catch((e) => {
    g.__db = undefined;
    throw e;
  });
  return g.__db;
}

export { schema };
