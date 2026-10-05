# EmployerCRM — Plan

## 1. Goal

A CRM that:

1. **Pulls job listings** from job sites (Craigslist first, others later) into one inbox.
2. **Tracks submissions**: which listings we applied/pitched to, when, with what (resume, cover note, pitch template).
3. **Tracks replies**: did the employer respond, what they said, and what happens next (interview, follow-up, rejected, ghosted).

Success = one screen that answers "what's new, what have we sent, who replied, who needs a follow-up today."

---

## 2. Limitations & restrictions (read first)

### Craigslist specifically

| Issue | What it means for us | Mitigation |
|---|---|---|
| **No official API** | There is no supported way to pull listings. Everything is either RSS (where still available) or reading the HTML pages. | Build the ingestor behind an adapter interface so it can be swapped or fixed without touching the CRM. |
| **Terms of Use forbid scraping / automated access** | Craigslist's ToU bans robots, spiders and scrapers and they have a history of suing (Craigslist v. 3Taps, v. RadPad — multi‑million judgments). Those cases targeted *republishing* listings commercially, but the ToU applies to any automated access. | Keep it **low-volume, internal-only**: a handful of city/category searches a few times a day, normal request rate, no republishing listings publicly, no reselling the data. Treat this as a real legal risk if the product is ever sold to others — get legal advice before that. |
| **IP blocking / CAPTCHA** | Craigslist blocks datacenter IPs (Vercel, AWS etc.) aggressively and rate-limits fast clients. | Run the fetcher from a residential connection (this machine / a small home box) or poll slowly. Don't plan on serverless cron hitting Craigslist directly. |
| **RSS feeds are unreliable** | Craigslist historically offered `?format=rss` on searches; it has been intermittently broken/removed. | Try RSS first; fall back to parsing the static search/listing HTML. Verify on day 1 which works. |
| **Page structure changes** | The search UI was rewritten (JS-rendered, 2023). HTML parsing breaks when they change markup. | Parser tests with saved HTML fixtures; health check that alerts when a run returns 0 listings. |
| **Contact info is hidden** | Employer email/phone sits behind a "reply" button with a CAPTCHA, and the email is an **anonymized relay** (`xxxx@job.craigslist.org`). | We do **not** auto-reveal contacts or auto-apply (that's the most bannable and most ToU-violating part). The user clicks "Reply" on Craigslist, then marks it submitted in the CRM (or the CRM opens a pre-filled email). |
| **Listings expire / get deleted** | Job posts last ~30 days and employers delete them. The URL dies. | Snapshot title, body, pay, location and posted date into our DB at ingest time. |
| **Duplicates & reposts** | Same job posted in multiple cities/categories or reposted weekly. | Dedupe by Craigslist post ID + a content hash (title + body normalized). |
| **Spam / scams** | Craigslist jobs have a high share of scam and MLM posts. | Keyword blocklist + a "hide/spam" button that trains a simple filter later. |

### Tracking replies

- Replies arrive **by email** (through the Craigslist relay or directly), not through Craigslist. To track them automatically we need **Gmail access** (Gmail API / OAuth, read-only scope) and to match threads to listings.
- Matching isn't perfect: relay addresses change, employers reply from personal addresses, or call instead. Plan for **auto-match + manual "link this email to a listing"**.
- Gmail API with restricted scopes requires Google app verification if used by people outside your own Google Workspace/test users. For internal use with <100 test users, unverified "testing" mode is fine.

### Other job sites (later phases)

- **Indeed, LinkedIn, ZipRecruiter, Glassdoor**: ToS forbid scraping, heavy anti-bot (Cloudflare, logins). LinkedIn actively litigates (hiQ v. LinkedIn ended in LinkedIn's favor on ToS grounds). Don't scrape these.
- Legit alternatives: **job aggregator APIs** (Adzuna, Jooble, USAJobs, The Muse, Remotive, Greenhouse/Lever public job board JSON for specific companies), or paid data providers (e.g. SerpAPI Google Jobs). These have rate limits and sometimes costs, but no legal exposure.
- Fallback that's always allowed: **email alerts** — subscribe to job-alert emails on each site and let the CRM parse them from Gmail.

### General

- Store only what's needed; employer contact data = personal data in some jurisdictions (CCPA/GDPR if EU employers). Don't share/sell it.
- Cold outreach volume: if submissions become automated email blasts, CAN-SPAM and Gmail sending limits (~500/day consumer, 2,000 Workspace) apply, and deliverability will tank. Keep sending human-paced.

---

## 3. Scope

### MVP (Phase 1) — Craigslist → manual submit → reply tracking
- Saved searches: city + category (e.g. `miami` / `jjj` all jobs, or sub-categories) + keywords + exclude keywords.
- Ingestor runs on a schedule, stores new listings, dedupes.
- **Listings inbox**: new / reviewed / hidden; filters by search, city, keyword, date, pay.
- **Pipeline per listing**: `New → Interested → Submitted → Replied → Interview → Offer/Won → Rejected/Lost/Ghosted`.
- "Submit" action: open the Craigslist post in a new tab, record what was sent (template, resume version, notes), timestamp.
- Manual reply logging (date, channel, summary) + follow-up date.
- Dashboard: new today, submitted this week, reply rate, follow-ups due.

### Phase 2 — Automatic reply tracking
- Gmail OAuth (read-only), poll the inbox/label.
- Auto-link replies to listings by: relay address we replied to, thread ID of our sent email, subject line, company name.
- Unmatched replies queue → one-click link to a listing.
- Optional: AI summary/classification of replies (interested / rejection / request for info / scam) using Claude.

### Phase 3 — More sources
- Adapter for aggregator APIs (Adzuna / Jooble / Greenhouse & Lever boards).
- Job-alert email parser (Indeed/LinkedIn/ZipRecruiter alert emails via Gmail).
- Cross-source dedupe.

### Phase 4 — Productivity
- Templates with variables (`{{title}}`, `{{company}}`) and send from Gmail inside the CRM (still one-by-one, human-triggered).
- Follow-up reminders (email/push).
- Multi-user (if a team works the leads): assignment, "who submitted".
- AI scoring of listings vs. our criteria.

---

## 4. Architecture

```
            ┌───────────────────────┐
            │  Fetcher (worker)     │  runs on residential IP (local box) on cron
            │  sources/craigslist   │  RSS → HTML fallback, polite rate limit
            └──────────┬────────────┘
                       │ upsert listings (dedupe)
                       ▼
┌──────────────┐   ┌─────────────────┐   ┌───────────────────┐
│ Gmail poller │──▶│  Postgres (DB)  │◀──│  Web app (Next.js)│  inbox, pipeline,
│ (Phase 2)    │   │                 │   │  on Vercel        │  dashboard
└──────────────┘   └─────────────────┘   └───────────────────┘
```

**Stack (proposed)**
- **Next.js (App Router) + TypeScript + Tailwind/shadcn** — web UI, deploy on Vercel.
- **Postgres** (Neon via Vercel Marketplace) + **Drizzle ORM**.
- **Fetcher**: a Node script in the same repo (`/worker`), run by cron on this machine (WSL) or a cheap VPS with a residential proxy. Uses `fetch` + `cheerio` for HTML, `fast-xml-parser` for RSS. Pushes into the same Postgres.
- **Auth**: single-user/team — simple magic link or bookmarkable access link to start.
- **Gmail**: Google OAuth + Gmail API (`gmail.readonly`, later `gmail.send`).

Why the fetcher is separate: Craigslist blocks cloud IPs, so the web app (Vercel) shouldn't be the thing that scrapes.

---

## 5. Data model (initial)

```
search          id, name, source, city, category, query, exclude_terms, active, last_run_at
listing         id, source, source_post_id, url, title, body, company, location, pay,
                posted_at, first_seen_at, last_seen_at, content_hash, status
                (new|interested|hidden|spam), search_id
submission      id, listing_id, submitted_at, method (cl_reply|email|website|phone),
                to_address, template_id, resume_version, notes
reply           id, listing_id, submission_id, received_at, channel (email|phone|text),
                from_address, subject, snippet, gmail_thread_id, classification, notes
pipeline_event  id, listing_id, from_stage, to_stage, at, note        -- audit trail
follow_up       id, listing_id, due_at, done_at, note
template        id, name, subject, body
fetch_run       id, search_id, started_at, finished_at, found, new, error   -- health
```

Unique key: `(source, source_post_id)`; secondary dedupe on `content_hash`.

---

## 6. Build order (milestones)

1. ~~**Day 1 — feasibility spike**~~ ✅ done 2026-10-05 — see §8.
2. Scaffold Next.js + Drizzle + Postgres, schema + migrations.
3. Craigslist adapter + worker with dedupe, rate limit, `fetch_run` logging, fixture tests.
4. Listings inbox UI + filters + hide/interested.
5. Submission flow + pipeline board (kanban) + manual reply logging + follow-ups.
6. Dashboard metrics.
7. Deploy web app to Vercel; schedule worker locally (cron/systemd timer).
8. Phase 2: Gmail OAuth + reply matching.
9. Phase 3+: additional sources.

---

## 7. Open questions

- ~~Who submits?~~ **Answered:** we pitch our services to businesses that are hiring. Internal use only, no reselling data.
- ~~Cities/categories?~~ **Answered:** Admin/Office (`ofc`) + Marketing/PR (`mar`) in Miami, New York, SF Bay.
- Single user or a team?
- Which Gmail account receives replies?
- OK to run the fetcher from this machine, or do we want a VPS + residential proxy?

---

## 8. Spike results (2026-10-05)

Ran `spike/craigslist.mjs` from this machine (home connection, WSL).

- **RSS is dead**: `?format=rss` returns **403 "Your request has been blocked."** → HTML only.
- **Search page works**: `https://www.craigslist.org/search/area/<area>?cat=<cat>&query=<q>` (old `<city>.craigslist.org/search/jjj` URLs 301 here). Server renders a static no-JS list (`li.cl-static-search-result`) with **title, URL, location** only.
  - Capped at **~320 newest results per search, no pagination** → poll every few hours per saved search so nothing falls off.
  - `query=` is real full-text search (matches body, not just title).
- **Listing page has structured data** (`#ld_posting_data`, schema.org JobPosting): company, job title, description, `datePosted`, `validThrough`, city/ZIP/geo, employment type. Plus `.attrgroup` (compensation, experience level) and `post id`. Parsing is stable because it's JSON, not markup.
- **No blocking** at 1 request / 3 s for search + 5 listing pages. Search page ≈ 180 KB, listing ≈ 25 KB.
- **Reposts**: the same job is reposted with a new post ID → dedupe on content hash (company + title + normalized body), not just post ID.
- Contact/reply email still not fetched (behind CAPTCHA) — by design.

**Ingest design that follows:** per saved search → fetch search page → diff URLs against DB → fetch only *new* listing pages at ~1 req/3 s → upsert. A typical run is 1 search request + a handful of detail requests.

---

## 9. Status (2026-10-05) — Phase 1 MVP built

- Next.js 16 app + Drizzle. DB is embedded PGlite locally (`./data/pglite`); `DATABASE_URL` switches to Neon/Postgres.
- Seeded searches: miami/newyork/sfbay × ofc/mar (~575 listings live at time of build).
- Pipeline (pitching services): `New → Qualified → Pitched → Replied → Meeting → Proposal → Won / Lost`, plus `Skipped`.
- Data model simplified vs §5: `submission`, `reply`, `pipeline_event`, `follow_up` collapsed into one
  `activities` timeline (type = pitch | reply | note | stage | follow_up) + `listings.next_follow_up_at`.
- Logging a pitch → stage Pitched + follow-up in N days. Logging a reply → stage Replied + follow-up due today.
  Stages only auto-advance forward.
- Fetch: dashboard button, `npm run fetch`, or `POST /api/fetch` (Bearer `CRON_SECRET`) for cron.

- 2026-10-05: per-user secret-key login (users table, admin Users page, `/auth?key=` login links, activity attribution).

**Next up**
1. Schedule the fetch every 3–4 h on this machine (cron → `/api/fetch`, app running via `npm start`).
2. Pitch templates with `{{company}}`/`{{title}}` + copy-to-clipboard on the listing page.
3. ~~Neon DB, deploy UI to Vercel~~ ✅ 2026-10-05 → https://employercrm.vercel.app (no login, by user's choice; noindex).
4. Phase 2: Gmail reply matching.
