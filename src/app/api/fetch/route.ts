import { isIngestRunning, runAllSearches } from '@/lib/ingest';

// Trigger a fetch from cron while the app is running locally:
//   curl -X POST -H "authorization: Bearer $CRON_SECRET" http://localhost:3000/api/fetch
// Waits for the run to finish and returns per-search results.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (isIngestRunning()) return Response.json({ status: 'already running' }, { status: 409 });
  const runs = await runAllSearches({ log: (m) => console.log(`[ingest] ${m}`) });
  return Response.json({ runs });
}
