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

- **CLI:** `npm run fetch` — runs every active search once. With local PGlite, **stop the dev server first**
  (PGlite allows one process at a time) or use the API below.
- **Cron while the app is running:** set `CRON_SECRET` in `.env.local`, then
  ```bash
  curl -X POST -H "authorization: Bearer $CRON_SECRET" http://localhost:3000/api/fetch
  ```
  every 3–4 hours. Craigslist only shows the ~320 newest results per search.

The fetcher must run from a home/residential connection — Craigslist blocks cloud IPs (Vercel, AWS).
It opens one page every 3 s and at most 60 new listings per search per run (`CL_DELAY_MS`, `CL_MAX_NEW_PER_SEARCH`).

## Users & login

Sign in with **your name + a key** — a word and 2 numbers, e.g. `tiger42` (case doesn't matter).

- **Sign up yourself** at `/register`: pick a name and key, you're in as a member. Anyone who has the URL can
  do this.
- **One-click link:** `/auth?name=Maria&key=tiger42` signs you in. Sessions last a year.
- **Admins** (Users page): add people (choose a key or leave blank for a random one), give someone a new key,
  turn people off, change roles. New key / turn off signs that person out everywhere.
- **Guessing protection:** 8 wrong keys for a name (or 30 from one IP) in 15 minutes blocks sign-in for that
  name for 15 minutes. Max 5 sign-ups per IP per 15 minutes. Keys are stored as salted scrypt hashes.
- **Locked out / first admin:** `npm run user:add -- "Name" admin [key]` creates the user, or gives an
  existing one a new key.
- Pitches, replies, notes and stage changes record who did them.

## Workflow

1. **Inbox** (home page) — new listings; we email every one. The **User** column shows who is working each lead (the first person to pitch, reply, note or move it; reassign on the listing page).
2. Open a listing → **Open on Craigslist** → reply (Craigslist shows the employer's relay email after a CAPTCHA)
   → **Log pitch**. Stage moves to *Pitched* and a follow-up is scheduled.
3. When they answer → **Log reply** (stage → *Replied*, follow-up due today).
4. Move through *Meeting → Proposal → Won/Lost* on the listing page; see everything on **Pipeline**.

## Gmail (company Workspace)

Each user connects their own company Gmail on **Settings** (read-only). The CRM then:

- logs every email you send to a `…@job.craigslist.org` address (or to an address found in a posting) as a
  **Pitch** on that listing — matched by the posting link in the email, the relay address, the business's
  email, or an exact title match — and remembers the relay address on the listing;
- logs anything else in that email thread as **Replies** (theirs) or follow-up pitches (yours);
- imports the last 60 days on connect, then syncs each mailbox at most every 5 minutes whenever someone
  opens the Inbox, on **Sync now**, and from a daily Vercel cron (`/api/gmail/sync`, Bearer `CRON_SECRET`).
- Pitches it can't match land in **Unmatched** (nav) to be linked by hand; unrelated mail is never stored.

### One-time Google setup (Workspace admin)

1. https://console.cloud.google.com → create a project in your company's organization.
2. **APIs & Services → Library** → enable **Gmail API**.
3. **OAuth consent screen** → User type **Internal** (no Google review, tokens don't expire), app name
   "EmployerCRM", add scopes `openid`, `email`, `…/auth/gmail.readonly`.
4. **Credentials → Create credentials → OAuth client ID → Web application**. Authorized redirect URIs:
   `https://employercrm.vercel.app/api/gmail/callback` and `http://localhost:3000/api/gmail/callback`.
5. Add the client ID/secret to Vercel (and optionally `GOOGLE_WORKSPACE_DOMAIN`), then redeploy:
   `vercel env add GOOGLE_CLIENT_ID production` / `GOOGLE_CLIENT_SECRET` → `vercel deploy --prod`.

`GMAIL_TOKEN_KEY` (encrypts stored Google tokens) and `CRON_SECRET` are already set in Vercel. Changing
`GMAIL_TOKEN_KEY` disconnects everyone. Tests: `npm run test:gmail`.

## Deployment

- **Live:** https://employercrm.vercel.app — sign in with a per-user secret key (marked `noindex` too).
- Pushing to `main` deploys automatically (or `npx vercel deploy --prod`).
- Database: Neon Postgres (Vercel Marketplace). `.env.local` (from `vercel env pull`) points local dev and
  `npm run fetch` at the same database. Remove `DATABASE_URL` from `.env.local` to use the local PGlite DB.
- **Fetching never runs on Vercel** (`/api/fetch` refuses). Run `npm run fetch` on this machine.

## Layout

```
src/lib/craigslist.ts   fetch + parse search pages and listing pages (JSON-LD)
src/lib/ingest.ts       run searches, dedupe (URL + content hash for reposts), log fetch_runs
src/db/schema.ts        searches, listings, activities (timeline), fetch_runs
src/app/                inbox (home), listing detail, pipeline, searches, users, /api/fetch
scripts/fetch.ts        CLI fetch
spike/                  original feasibility script
```

Schema changes: edit `src/db/schema.ts`, then `npm run db:generate`.
