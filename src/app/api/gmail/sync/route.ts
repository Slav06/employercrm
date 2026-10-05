import { gmailConfigured } from '@/lib/gmail/google';
import { syncAccounts } from '@/lib/gmail/sync';

export const maxDuration = 300;

// Vercel Cron (GET) and local cron (POST) both send `Authorization: Bearer $CRON_SECRET`.
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!gmailConfigured()) return Response.json({ error: 'gmail not configured' }, { status: 503 });
  return Response.json({ results: await syncAccounts() });
}

export const GET = handle;
export const POST = handle;
