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

## Safety boundary

Tickets are paper-only. A ticket version is append-only, uses one bookmaker, and cannot be changed after publication; pre-kickoff corrections create a successor version. Historical results support calibration only. ROI and CLV require locally captured pre-kickoff quotes.
