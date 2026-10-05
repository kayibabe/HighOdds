import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const HighOdds = github("kayibabe/HighOdds", { checkSuites: false });

  const Postgres = postgres("Postgres", { region: "europe-west4-drams3a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 5000 });
  const jobs = service("jobs", {
    source: HighOdds,
    build: "npm ci && npm run db:generate",
    start: "npm run db:migrate:deploy --workspace=@highodds/db && npm run jobs:run-due --workspace=@highodds/jobs",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { cronSchedule: "*/5 * * * *", restartPolicyType: "NEVER" },
    env: { API_FOOTBALL_DAILY_QUOTA: preserve(), API_FOOTBALL_KEY: preserve(), API_FOOTBALL_QUOTA_SAFETY_PERCENT: preserve(), DATABASE_URL: preserve() },
  });
  const web = service("web", {
    source: HighOdds,
    build: "npm ci && npm run db:generate && npm run build --workspace=@highodds/web && mkdir -p apps/web/.next/standalone/apps/web/.next && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static",
    start: "npm run db:migrate:deploy --workspace=@highodds/db && HOSTNAME=0.0.0.0 node apps/web/.next/standalone/apps/web/server.js",
    replicas: { "europe-west4-drams3a": 1 },
    env: { ADMIN_EMAIL: preserve(), API_FOOTBALL_DAILY_QUOTA: preserve(), API_FOOTBALL_KEY: preserve(), API_FOOTBALL_QUOTA_SAFETY_PERCENT: preserve(), AUTH_SECRET: preserve(), DATABASE_URL: preserve(), EMAIL_FROM: preserve() },
  });

  return project("Highodds", {
    resources: [jobs, web, Postgres, postgresVolume],
  });
});
