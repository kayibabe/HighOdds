# HighOdds Product Audit and Roadmap

## Purpose

HighOdds is a paper-validation football analytics platform. Its job is to turn pre-kickoff data, forecasts, captured prices, and settlement evidence into an explainable research decision. It is not an execution venue and must not imply guaranteed outcomes.

## Current audit

### Verified strengths

- The core pipeline persists fixtures, odds quotes, model runs, predictions, tickets, ticket legs, settlements, and candidate-universe snapshots.
- Prediction evaluation uses walk-forward safeguards: the forecast must precede kickoff and the model training cutoff must not be later than the forecast timestamp.
- Ticket and leg history is append-only and settlement evidence is retained for later attribution.
- Fixture inspection exposes model probabilities, comparable historical evidence, captured prices, ticket membership, and result scoring.
- The analysis area includes pipeline health, model coverage, calibration, candidate-universe comparison, ticket performance, and quote/CLV diagnostics.
- The product clearly labels itself as paper research and keeps production betting execution outside the system.

### Implemented in this pass

- Added a decision-first daily summary separating published paper tickets from finished walk-forward signals.
- Added explicit sample counts, average recorded probability, paper result, and open-ticket status to the daily desk.
- Added visible BET, WATCH, and PASS language with paper-only context.
- Added rationale and risk sections to published-leg evidence: model estimate, captured implied probability, consensus, agreement, point-in-time limitations, and publishing-rule caveats.
- Added a match-level executive summary to Fixture Inspector with BET/WATCH/PASS, leading market, model probability, captured odds, implied probability, fair odds, edge, rationale, and explicit limitations.
- Renamed the primary navigation group to Betting desk and the daily page to Today’s Intelligence.

### Remaining product gaps

These are the remaining workstreams, ordered by user value and evidence risk:

1. Unify the dashboard, fixture inspector, screener, results, and analysis pages around one shared date/range and filter state.
2. Add a dedicated match-intelligence executive summary with a single BET/WATCH/PASS verdict, ranked evidence, risks, fair odds, and exposure context.
3. Add explicit data-quality status to user-facing decision surfaces, including stale quotes, missing model inputs, incomplete results, and unavailable provenance.
4. Extend performance analytics with market, league, odds-band, confidence-band, model, and single-versus-accumulator breakdowns, each with sample-size warnings.
5. Add bankroll and exposure views only when bankroll transactions and stake inputs are persisted with sufficient provenance; do not infer them from ticket odds.
6. Add correlation diagnostics for accumulator legs and expose a warning when selections are related but treated as independent.
7. Improve responsive tables and mobile progressive disclosure for the daily desk and match details.
8. Add independent calculation fixtures for ROI, drawdown, calibration, odds bands, and accumulator failure attribution.
9. Complete operational verification against the live Railway services: migrations, health, scheduler completion, persisted publications, and post-kickoff settlement evidence.

## Product decisions

- Grade, confidence, and risk must remain separate concepts. The current data model has confidence and selection thresholds, but it does not yet persist a general grade/risk taxonomy; the UI must not invent one.
- A missing quote or missing provenance is unavailable evidence, not zero edge and not neutral evidence.
- Historical performance must remain walk-forward and prospective where price evidence is required. Later quotes must never be used to reconstruct a historical decision.
- Small samples must be labelled as unreliable or insufficient rather than promoted as profitable strategies.
- “No qualified selections” is a valid daily result and should remain visible.

## Recommended next implementation phase

Build the user-facing data-quality and exposure layer on top of the existing pipeline-health and ticket evidence. It should surface stale or missing inputs before a decision is interpreted, and it must refuse to infer bankroll risk when stake and bankroll transactions are not persisted.
