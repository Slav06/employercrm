// Run all active searches once: `npm run fetch`.
// With local PGlite, stop the dev server first (or use POST /api/fetch instead).
import { runAllSearches } from '@/lib/ingest';

runAllSearches({ log: console.log })
  .then((runs) => {
    console.table(runs);
    process.exit(runs.some((r) => r.error) ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
