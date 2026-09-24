/**
 * Pipeline settings shared by the jobs runner (which acts on them) and the web app (which reports
 * them), so the analysis page can never describe a different rule from the one that ran.
 */

/** Predictions and tickets only consider fixtures kicking off within this many hours of the run. */
export const SELECTION_WINDOW_HOURS = 20;

/** Daily jobs, created idempotently per UTC day. 06:00 UTC is 08:00 Africa/Blantyre. */
export const DAILY_JOB_SCHEDULE = [
  { jobType: "INGEST_FIXTURES", utcTime: "00:05" },
  { jobType: "TRAIN_MODEL", utcTime: "05:00" },
  { jobType: "INGEST_ODDS", utcTime: "05:30" },
  { jobType: "PUBLISH_TICKETS", utcTime: "06:00" },
  { jobType: "SETTLE_RESULTS", utcTime: "21:00" }
] as const;

/** A claimed job not completed within this lease is requeued. */
export const JOB_LEASE_MINUTES = 20;
/** A failed job is released to run again after this delay. */
export const JOB_RETRY_MINUTES = 5;
