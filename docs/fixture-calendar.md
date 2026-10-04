# Seven-day match calendar

HighOdds discovers today and the following six Africa/Blantyre calendar days. Fixture
ingestion queries the eight UTC dates intersecting that local window, including the
previous UTC date for matches between local midnight and 02:00. The database remains
the shared fixture source for the dashboard, Inspector, models, odds, and settlement.

The daily scheduler retains today's existing INGEST_FIXTURES job and creates one job
for each additional UTC date at 00:05 UTC. Daily/date idempotency keys prevent duplicate
execution on cron ticks, while allowing the whole horizon to refresh the following day.
Each date retries independently after failure. Payloads record the requested date and
ingested/rejected counts. Overlapping fixtures are upserted by provider ID, refreshing
kickoff, status and team/competition details. Failed jobs preserve partial database
progress; rerunning their date safely upserts it again.

The existing API usage counter includes every request; the shared provider key's quota
remains the ceiling. A complete daily calendar normally uses eight fixture requests,
seven more than the previous daily job, before retries or provider pagination. Missing
fixtures are not deleted merely because a date returns fewer records. Postponement and
cancellation updates depend on the provider returning the fixture's new state.

The calendar is available on High Probability Matches and the Fixture Inspector, with
an expandable entry on Paper Tickets. Admin and Analysis show the same date counts and
refresh coverage. Counts represent stored matches of all statuses, not qualified picks;
zero counts during incomplete refresh must not be treated as a confirmed empty slate.
The Inspector lists every pulled fixture for the chosen day, including unforecast matches.

Predictions, odds coverage and publication retain the 20-hour selection window. Bulk
odds ingestion covers all UTC dates intersecting that window, including tomorrow when
needed. Forecasts outside this window are not fabricated. Historical screening, model
training, performance denominators, immutable decisions and settlement rules are unchanged.

Deployment needs no schema migration. On the first jobs tick, additional calendar dates
are queued even if today's original ingestion already completed. Verify persisted
per-date DONE jobs, future fixture counts, production health and served calendar views.
