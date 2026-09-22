# HighOdds

HighOdds is a paper-validation football analytics platform. It never places bets and keeps source odds, ticket decisions, and settlement evidence immutable.

## Local start

1. Copy `.env.example` to `.env` and set a local `DATABASE_URL`.
2. Start Postgres: `docker compose up -d postgres`.
3. Install dependencies: `npm install`.
4. Generate Prisma: `npm run db:generate`.
5. Apply migrations: `npm run db:migrate`.
6. Start the web app: `npm run dev --workspace=@highodds/web`.

Run the jobs runner with `npm run jobs:run-due --workspace=@highodds/jobs`. The Railway cron service runs this command every five minutes; it claims overdue jobs from Postgres rather than trusting an in-process clock.

Next.js only loads `.env` from the app it runs in, not the monorepo root — for local `npm run dev --workspace=@highodds/web`, also copy `.env.example` to `apps/web/.env` (or export the variables another way). The jobs runner does not read `.env` files at all; provide env vars directly (shell, Railway service config) when running it.

Create the first admin account with `npm run db:seed-admin --workspace=@highodds/db` after setting `ADMIN_EMAIL` and `ADMIN_PASSWORD` (12+ chars) in the environment. This upserts an `AdminCredential` and a `User` with `role=ADMIN`; sign in with the admin email/password form at `/signin` (below the subscriber magic-link form). It posts to a server action that calls the NextAuth credentials provider directly, so no CSRF token handling is needed; an incorrect email or password redirects back to `/signin?error=invalid-credentials` with an inline message.

### Running tests

`npm test` runs the full suite. `apps/jobs/test/ingestion.integration.test.ts` additionally runs against a
live Postgres whenever `DATABASE_URL` is set, and its `afterAll` deletes rows by provider ID — **never point
it at your dev database.** Create a separate `highodds_test` database against the docker-compose Postgres
(e.g. `docker exec <postgres-container> psql -U highodds -d highodds -c "CREATE DATABASE highodds_test OWNER
highodds"`), then apply migrations and run tests with `DATABASE_URL` pointing at it:

PowerShell (Windows):

```powershell
$env:DATABASE_URL = "postgresql://highodds:highodds@localhost:55432/highodds_test?schema=public"
npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
npm test
```

bash/zsh (macOS/Linux):

```bash
export DATABASE_URL="postgresql://highodds:highodds@localhost:55432/highodds_test?schema=public"
npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
npm test
```

The test suite refuses to run (throws instead of silently deleting data) if `DATABASE_URL`'s database name
doesn't end in `_test`. Its synthetic provider IDs are also randomized per run, since a `_test`-suffixed name
only signals intent — it doesn't guarantee the database is empty or exclusive to one run.

## Model pipeline, publication, and settlement

- `TRAIN_MODEL` (daily, and on demand from the admin console) fits per-competition team attack/defense
  strengths via iterative proportional fitting (`packages/core/src/train.ts`) from the last 365 days of
  `FINISHED` fixtures (minimum 50 matches) and persists a `ModelRun`.
- `ModelRun.competitionId` (migration `20260920214926_add_modelrun_competition`) is nullable with
  `ON DELETE SET NULL` by design: every `ModelRun` created by `trainModel` always sets it, and this project
  has never had a production deployment, so no pre-existing `ModelRun` rows can exist without it. A
  `competitionId IS NULL` row is not a migration artifact to backfill — it signals a bug in whatever created
  it. `generatePredictions` intentionally ignores such rows (no competition to match a fixture against), and
  the admin console's model diagnostics table renders their competition as "—". If this schema is ever
  migrated against a database that already has `ModelRun` rows, backfill `competitionId` before relying on
  predictions, or archive the orphaned rows.
- `PUBLISH_TICKETS` first generates `Prediction` rows for fixtures kicking off in the next 20 hours
  (`apps/jobs/src/predict.ts`), then builds candidate legs from fresh pre-kickoff quotes and calls the
  existing `buildTickets` tier logic, inserting `TicketVersion`/`TicketLeg` rows (or a successor version if
  the prior one for that date/tier isn't locked yet).
- `SETTLE_RESULTS` resolves locked, unsettled ticket versions once every leg's fixture is `FINISHED` (or
  voids the ticket if any leg's fixture was postponed/cancelled) and inserts exactly one `Settlement` row —
  matching the database triggers, which reject every other update to `TicketVersion`/`TicketLeg`.
- Market/selection normalization (`apps/jobs/src/markets.ts`) matches API-Football bet names by text
  (`"Match Winner"`, `"Goals Over/Under"` 2.5 line only, `"Both Teams Score"`) and has been **verified against
  live payloads**: a captured Premier League fixture (`apps/jobs/test/fixtures/odds-brighton-arsenal.json`,
  exercised by `apps/jobs/test/markets.test.ts`) and, separately, a fresh live pull of an upcoming La Liga
  fixture across 6 bookmakers (William Hill, Bet365, Marathonbet, Pinnacle, SBO, 1xBet) on 2026-09-22. Every
  `Match Winner`/`Both Teams Score` value from every bookmaker resolved correctly, near-miss bet names
  (`"Goals Over/Under First Half"`, `"Results/Both Teams Score"`, etc.) were correctly rejected by the exact
  string match, and bookmakers whose Asian goal line skips 2.5 entirely (Pinnacle, SBO) simply yield no
  `TOTAL_GOALS` leg for that bookmaker rather than erroring — expected behavior, not a bug.

## Deploying to Railway (not yet executed)

1. Create two Railway services from this repo: a web service (uses `railway.json`) and a cron worker (uses
   `railway.jobs.json`, already configured to run `npm run jobs:run-due --workspace=@highodds/jobs` every 5
   minutes).
2. Set env vars from `.env.example` on both services (`DATABASE_URL` pointing at a Railway/managed Postgres,
   `API_FOOTBALL_KEY`, `AUTH_SECRET`, `AUTH_RESEND_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL`).
3. Apply migrations non-interactively: `npm run db:migrate:deploy --workspace=@highodds/db` (do **not** use
   the interactive `db:migrate` script in production).
4. Seed the admin account once: set `ADMIN_PASSWORD` and run
   `npm run db:seed-admin --workspace=@highodds/db` against the production `DATABASE_URL`, then unset it.
5. Verify `API_FOOTBALL_KEY` before relying on it:
   `curl -H "x-apisports-key: $API_FOOTBALL_KEY" "https://v3.football.api-sports.io/status"`
6. Verify Resend: the sending domain behind `EMAIL_FROM` must be verified in the Resend dashboard, or magic
   links will fail to send.
7. Post-deploy checks: `GET /api/health` returns `{"status":"ok"}`; the admin console's Jobs & quota panel
   shows `INGEST_FIXTURES`/`TRAIN_MODEL` completing (`DONE`) rather than failing repeatedly.

None of steps 1–6 have been executed by this assistant — no live API-Football/Resend calls were made and no
Railway deployment was attempted, since this session has no such credentials or account access.

## Safety boundary

Tickets are paper-only. A ticket version is append-only, uses one bookmaker, and cannot be changed after
publication; pre-kickoff corrections create a successor version. Historical results support calibration
only. ROI and CLV require locally captured pre-kickoff quotes.
