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

Selection-window predictions, odds coverage and publication retain the 20-hour window. Bulk
odds ingestion covers all UTC dates intersecting that window, including tomorrow when
needed. Historical screening, model
training, performance denominators, immutable decisions and settlement rules are unchanged.

On the first jobs tick, additional calendar dates
are queued even if today's original ingestion already completed. Verify persisted
per-date DONE jobs, future fixture counts, production health and served calendar views.

## Evening forecasts

EVENING_FORECAST runs at 20:00 UTC (22:00 Malawi time), forecasting tomorrow's entire
local calendar day, including evening matches beyond the 20-hour selection window.
The job pins its targetDate in its payload so a retry after midnight still addresses
the intended date and excludes matches already started. It uses stored fixtures and
the latest model trained by the forecast time; it makes no additional provider calls,
does not retrain, capture odds, or publish tickets. Missing models, team strengths or
sufficient league/team history still produce no forecast.

Prediction.stage separates PRELIMINARY from SELECTION, with historical rows defaulting
to SELECTION. Both stages retain their original timestamp and model lineage; a morning
forecast can be created even with the same model that produced the preview. Repeating
the same stage/model/match is idempotent. The morning TRAIN_MODEL (07:00 local), odds
coverage (07:45 local) and publication (08:00 local) schedule remains in place.

The Inspector and High Probability Matches show preview labels and forecast times,
and prefer an eligible SELECTION forecast whenever available. Captured prices retain
their capture timestamps. Ticket selection, odds-coverage targets and existing historical
calibration/performance reports explicitly exclude PRELIMINARY rows. The stage is not
evidence of a bet's profitability or qualification.

Apply migration 20261004220000_prediction_stage before releasing the new web/jobs code.
It adds a defaulted enum column without changing existing forecasts or ticket decisions.
