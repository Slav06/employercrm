# EmployerCRM

Find businesses that are hiring (Craigslist first), pitch them our services, and track pitches, replies, and follow-ups.

See [PLAN.md](PLAN.md) for the full plan, limitations, and roadmap.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

With `.env.local` pulled from Vercel this uses the production Neon database. Without `DATABASE_URL` it uses
an embedded Postgres (PGlite) in `./data/pglite`. Migrations run and the starting searches are created
automatically on first load.

## Getting listings

- **In the app:** Dashboard → **Fetch new listings** (runs in the background; refresh to watch progress).
- **CLI:** `npm run fetch` — runs every active search once. With local PGlite, **stop the dev server first**
  (PGlite allows one process at a time) or use the API below.
- **Cron while the app is running:** set `CRON_SECRET` in `.env.local`, then
  ```bash
  curl -X POST -H "authorization: Bearer $CRON_SECRET" http://localhost:3000/api/fetch
  ```
  every 3–4 hours. Craigslist only shows the ~320 newest results per search.

The fetcher must run from a home/residential connection — Craigslist blocks cloud IPs (Vercel, AWS).
It opens one page every 3 s and at most 60 new listings per search per run (`CL_DELAY_MS`, `CL_MAX_NEW_PER_SEARCH`).

## Workflow

1. **Inbox** — new listings. *Qualify* the ones worth pitching, *Skip* the rest.
2. Open a listing → **Open on Craigslist** → reply (Craigslist shows the employer's relay email after a CAPTCHA)
   → **Log pitch**. Stage moves to *Pitched* and a follow-up is scheduled.
3. When they answer → **Log reply** (stage → *Replied*, follow-up due today).
4. Move through *Meeting → Proposal → Won/Lost* on the listing page; see everything on **Pipeline**.
5. **Dashboard** shows new listings, reply rate, follow-ups due, and fetch health.

## Deployment

- **Live:** https://employercrm.vercel.app — **no login by choice**: anyone with the URL can view and edit. It's
  marked `noindex` so search engines skip it.
- Pushing to `main` deploys automatically (or `npx vercel deploy --prod`).
- Database: Neon Postgres (Vercel Marketplace). `.env.local` (from `vercel env pull`) points local dev and
  `npm run fetch` at the same database. Remove `DATABASE_URL` from `.env.local` to use the local PGlite DB.
- **Fetching never runs on Vercel** (button hidden, `/api/fetch` refuses). Run `npm run fetch` on this machine.

## Layout

```
src/lib/craigslist.ts   fetch + parse search pages and listing pages (JSON-LD)
src/lib/ingest.ts       run searches, dedupe (URL + content hash for reposts), log fetch_runs
src/db/schema.ts        searches, listings, activities (timeline), fetch_runs
src/app/                dashboard, inbox, listing detail, pipeline, searches, /api/fetch
scripts/fetch.ts        CLI fetch
spike/                  original feasibility script
```

Schema changes: edit `src/db/schema.ts`, then `npm run db:generate`.
