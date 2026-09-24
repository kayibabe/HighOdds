import { redirect } from "next/navigation";
import {
  CONFIDENCE_THRESHOLDS, DAILY_JOB_SCHEDULE, DIXON_COLES_RHO, EV_HAIRCUT, EXPECTED_GOALS_FLOOR, HISTORY_LOOKBACK_DAYS, IPF_ITERATIONS,
  JOB_LEASE_MINUTES, JOB_RETRY_MINUTES, LEAGUE_MIN_MATCHES, MAX_LEGS_PER_LEAGUE, MIN_LEG_ODDS, MIN_TICKET_LEGS, MODEL_METHOD,
  QUOTE_MAX_AGE_MINUTES, resolveDayRange, SCORELINE_MAX_GOALS, SELECTION_WINDOW_HOURS, TEAM_MIN_MATCHES, TICKET_TIERS, utcToday,
  type CalibrationBucket
} from "@highodds/core";
import { auth } from "../../auth";
import { loadCalibration, loadModelCoverage, loadPipelineHealth, loadTicketPerformance, loadUpcomingFunnel } from "../../lib/analysis";
import { RangeNav, rangeLabel } from "../date-nav";

export const dynamic = "force-dynamic";

const pct = (value: number | null, digits = 1) => value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
const num = (value: number | null, digits = 2) => value === null ? "—" : value.toFixed(digits);
const count = (value: number) => value.toLocaleString("en-GB");
const label = (value: string) => value.replaceAll("_", " ");
const signedPp = (value: number) => `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`;
const BLANTYRE = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Blantyre", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const when = (value: Date | null) => value ? BLANTYRE.format(value) : "Never";

function ago(value: Date | null, now: Date): string {
  if (!value) return "no record";
  const minutes = Math.round((now.getTime() - value.getTime()) / 60000);
  if (minutes < 0) return "scheduled ahead";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

const SECTIONS = [
  { id: "parameters", title: "Decision parameters" },
  { id: "pipeline", title: "Pipeline health" },
  { id: "funnel", title: `Next ${SELECTION_WINDOW_HOURS}h funnel` },
  { id: "model", title: "Model coverage" },
  { id: "calibration", title: "Calibration" },
  { id: "tickets", title: "Ticket performance" }
];

type Parameter = { name: string; value: string; effect: string };

const PARAMETER_GROUPS: Array<{ title: string; rows: Parameter[] }> = [
  {
    title: "Evidence and model",
    rows: [
      { name: "Model method", value: MODEL_METHOD, effect: "Poisson team attack/defence strengths fitted per competition by iterative proportional fitting, projected through a Dixon-Coles scoreline grid." },
      { name: "History lookback", value: `${HISTORY_LOOKBACK_DAYS} days`, effect: "Finished matches older than this are ignored, both for training and for a fixture's evidence check." },
      { name: "League evidence floor", value: `${LEAGUE_MIN_MATCHES} matches`, effect: "A competition with fewer finished matches in the lookback is not trained, and its fixtures are not scored." },
      { name: "Team evidence floor", value: `${TEAM_MIN_MATCHES} matches each`, effect: "Both teams need this many finished matches in the lookback before a fixture gets a prediction." },
      { name: "Fitting passes", value: String(IPF_ITERATIONS), effect: "Fixed number of attack, defence and home-advantage update passes per training run." },
      { name: "Dixon-Coles ρ", value: String(DIXON_COLES_RHO), effect: "Adjusts 0–0, 1–0, 0–1 and 1–1 probabilities for low-score dependence." },
      { name: "Scoreline grid", value: `0–${SCORELINE_MAX_GOALS} goals a side`, effect: "Scorelines enumerated when turning expected goals into market probabilities." },
      { name: "Expected-goals floor", value: String(EXPECTED_GOALS_FLOOR), effect: "Minimum expected goals per side, so a very weak attack still yields a defined distribution." }
    ]
  },
  {
    title: "Leg eligibility",
    rows: [
      { name: "Markets", value: "Match winner · Over/Under 2.5 · Both teams score", effect: "Only these normalised markets are predicted, priced and eligible for tickets." },
      { name: "Minimum leg odds", value: MIN_LEG_ODDS.toFixed(2), effect: "Shorter prices are rejected as a ticket leg." },
      { name: "EV haircut", value: pct(EV_HAIRCUT, 0), effect: `Conservative EV = p × (1 − ${EV_HAIRCUT}) × odds − 1 must be above zero.` },
      { name: "Quote freshness", value: `${QUOTE_MAX_AGE_MINUTES} min`, effect: "A leg's price must be captured before kickoff and no older than this when the ticket is built." },
      { name: "Market consensus", value: "Proportional de-vig, averaged", effect: "Each bookmaker's full market is de-vigged; partial markets are skipped so a missing outcome is not priced as impossible." },
      { name: "Confidence score", value: "min(model, consensus) ÷ max × 100", effect: "Agreement between the model and the market; tickets require a minimum score." }
    ]
  },
  {
    title: "Ticket construction",
    rows: [
      ...TICKET_TIERS.map((tier) => ({ name: `${tier.key} tier`, value: tier.maxOddsExclusive === null ? `≥ ${tier.minOdds}` : `${tier.minOdds} – < ${tier.maxOddsExclusive}`, effect: "Combined decimal odds band for the tier's accumulator." })),
      { name: "Confidence thresholds", value: CONFIDENCE_THRESHOLDS.join(" → "), effect: `Tried strictest first; a ticket built below ${CONFIDENCE_THRESHOLDS[0]} is marked relaxed.` },
      { name: "Legs per ticket", value: `≥ ${MIN_TICKET_LEGS}, ≤ ${MAX_LEGS_PER_LEAGUE} per competition`, effect: "Accumulators only, with a cap on legs from one competition." },
      { name: "Bookmaker", value: "One per ticket, by priority", effect: "Active bookmakers are tried in priority order; every leg of a ticket uses the same one." },
      { name: "Fixture overlap", value: "None across tiers", effect: "Tiers never share a fixture, so one result cannot sink several tickets; STANDARD picks first." }
    ]
  },
  {
    title: "Pipeline",
    rows: [
      { name: "Selection window", value: `${SELECTION_WINDOW_HOURS} h`, effect: "Predictions and tickets only consider fixtures kicking off this soon after the run." },
      ...DAILY_JOB_SCHEDULE.map((job) => ({ name: label(job.jobType), value: `${job.utcTime} UTC`, effect: "Daily job created idempotently; the runner picks it up on its next pass after this time." })),
      { name: "Job lease / retry", value: `${JOB_LEASE_MINUTES} min / ${JOB_RETRY_MINUTES} min`, effect: "A claimed job not finished within the lease is requeued; a failed job retries after the delay." }
    ]
  }
];

function ReliabilityChart({ buckets }: { buckets: CalibrationBucket[] }) {
  const size = 260; const pad = 34; const plot = size - pad - 10;
  const x = (value: number) => pad + value * plot;
  const y = (value: number) => 10 + (1 - value) * plot;
  const filled = buckets.filter((bucket) => bucket.predictions > 0 && bucket.meanPredicted !== null && bucket.observedRate !== null);
  const maxCount = Math.max(1, ...filled.map((bucket) => bucket.predictions));
  return <svg className="reliability-chart" viewBox={`0 0 ${size} ${size}`} role="img" aria-labelledby="reliability-title reliability-desc">
    <title id="reliability-title">Reliability diagram</title>
    <desc id="reliability-desc">Observed frequency against mean predicted probability for each probability bucket. Points on the diagonal are perfectly calibrated. The table beside it lists the same values.</desc>
    {[0, 0.25, 0.5, 0.75, 1].map((tick) => <g key={tick}>
      <line className="reliability-grid" x1={x(0)} x2={x(1)} y1={y(tick)} y2={y(tick)} />
      <text className="reliability-tick" x={pad - 6} y={y(tick) + 3} textAnchor="end">{tick * 100}</text>
      <text className="reliability-tick" x={x(tick)} y={size - 14} textAnchor="middle">{tick * 100}</text>
    </g>)}
    <line className="reliability-diagonal" x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} />
    {filled.map((bucket) => <circle key={bucket.lower} className="reliability-point" cx={x(bucket.meanPredicted!)} cy={y(bucket.observedRate!)} r={4 + 5 * Math.sqrt(bucket.predictions / maxCount)}>
      <title>{`${pct(bucket.lower, 0)}–${pct(bucket.upper, 0)}: predicted ${pct(bucket.meanPredicted)}, observed ${pct(bucket.observedRate)} (${count(bucket.predictions)} forecasts)`}</title>
    </circle>)}
    <text className="reliability-axis" x={x(0.5)} y={size - 1} textAnchor="middle">Predicted %</text>
    <text className="reliability-axis" x={10} y={y(0.5)} textAnchor="middle" transform={`rotate(-90 10 ${y(0.5)})`}>Observed %</text>
  </svg>;
}

export default async function AnalysisPage({ searchParams }: { searchParams: Promise<{ range?: string | string[]; from?: string | string[]; to?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");
  if (session.user.role !== "ADMIN") redirect("/signin");

  const params = await searchParams;
  const now = new Date();
  const today = utcToday(now);
  const range = resolveDayRange(params, today);
  const period = rangeLabel(range);

  const [pipeline, funnel, model, calibration, tickets] = await Promise.all([
    loadPipelineHealth(now), loadUpcomingFunnel(now), loadModelCoverage(now), loadCalibration(range), loadTicketPerformance(range)
  ]);

  const pooled = calibration.byMarket.find((row) => row.market === "ALL") ?? null;
  const ticketTotals = tickets.tiers.reduce((sum, tier) => ({ wins: sum.wins + tier.wins, decided: sum.decided + tier.wins + tier.losses }), { wins: 0, decided: 0 });
  const failingJobs = pipeline.jobHealth.filter((job) => job.latestStatus !== "DONE" && job.lastError).length;
  const todayQuota = pipeline.quota.find((row) => row.usageDate.toISOString().slice(0, 10) === today) ?? null;
  const funnelMax = Math.max(1, funnel.steps[0]!.count);

  return (
    <section className="analysis">
      <p className="eyebrow">SYSTEM ANALYSIS</p>
      <h1>Analysis</h1>
      <p>Every parameter that shapes a paper ticket, from the rules the jobs apply to how the model and tickets have actually performed. The rule values below come from the same code the jobs run.</p>

      <nav className="analysis-toc" aria-label="Analysis sections">
        {SECTIONS.map((section) => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}
      </nav>

      <RangeNav basePath="/analysis" range={range} today={today} />
      <p className="meta">Performance period: <strong>{period}</strong>. The period applies to calibration and ticket performance; parameters, pipeline health, the funnel and model coverage always show the current state.</p>

      <div className="analysis-kpis" aria-label="Headline figures">
        <article><small>Modelled competitions</small><strong>{count(model.competitions)}</strong><span>{model.stale > 0 ? `${count(model.stale)} older than ${model.staleBeforeHours}h` : "All trained recently"}</span></article>
        <article><small>Next {funnel.windowHours}h</small><strong>{count(funnel.steps[2]!.count)} / {count(funnel.steps[0]!.count)}</strong><span>fixtures with a prediction</span></article>
        <article><small>Brier · {period}</small><strong>{pooled ? pooled.brier.toFixed(4) : "—"}</strong><span>{count(calibration.scored)} scored forecasts</span></article>
        <article><small>Ticket hit rate · {period}</small><strong>{ticketTotals.decided ? pct(ticketTotals.wins / ticketTotals.decided) : "—"}</strong><span>{count(tickets.tickets)} tickets, {count(ticketTotals.decided)} decided</span></article>
        <article><small>Average CLV</small><strong>{tickets.clv === null ? "—" : `${tickets.clv.toFixed(2)}%`}</strong><span>settled legs in period</span></article>
        <article className={failingJobs > 0 ? "attention" : undefined}><small>Jobs needing attention</small><strong>{failingJobs}</strong><span>{todayQuota ? `API ${count(todayQuota.requestCount)} / ${count(todayQuota.quotaLimit)} today` : "No API calls today"}</span></article>
      </div>

      <section id="parameters" className="analysis-section" aria-labelledby="parameters-title">
        <h2 id="parameters-title">Decision parameters</h2>
        <p className="meta">Configured rules. Changing one means changing code in <code>@highodds/core</code>; this page updates with it. The API quota limit and safety margin are set per environment and shown under pipeline health.</p>
        {PARAMETER_GROUPS.map((group) => <div key={group.title} className="matches-table-wrap">
          <table className="analysis-table param-table">
            <caption>{group.title}</caption>
            <thead><tr><th scope="col">Parameter</th><th scope="col">Value</th><th scope="col">Effect</th></tr></thead>
            <tbody>{group.rows.map((row) => <tr key={row.name}><th scope="row">{row.name}</th><td className="num">{row.value}</td><td>{row.effect}</td></tr>)}</tbody>
          </table>
        </div>)}
      </section>

      <section id="pipeline" className="analysis-section" aria-labelledby="pipeline-title">
        <h2 id="pipeline-title">Pipeline health</h2>
        <div className="analysis-split">
          <div className="matches-table-wrap">
            <table className="analysis-table">
              <caption>Data freshness</caption>
              <thead><tr><th scope="col">Latest</th><th scope="col">When (Blantyre)</th><th scope="col">Age</th></tr></thead>
              <tbody>{pipeline.freshness.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td className="num">{when(row.at)}</td><td className="num">{ago(row.at, now)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="matches-table-wrap">
            <table className="analysis-table">
              <caption>Inventory</caption>
              <tbody>
                <tr><th scope="row">Competitions / teams</th><td className="num">{count(pipeline.inventory.competitions)} / {count(pipeline.inventory.teams)}</td></tr>
                <tr><th scope="row">Fixtures by status</th><td>{["SCHEDULED", "LIVE", "FINISHED", "POSTPONED", "CANCELLED"].map((status) => `${label(status).toLowerCase()} ${count(pipeline.fixturesByStatus[status] ?? 0)}`).join(" · ")}</td></tr>
                <tr><th scope="row">Bookmakers active</th><td className="num">{count(pipeline.inventory.activeBookmakers)} of {count(pipeline.inventory.bookmakers)}</td></tr>
                <tr><th scope="row">Markets normalised</th><td className="num">{count(pipeline.inventory.normalizedMarkets)} of {count(pipeline.inventory.markets)}</td></tr>
                <tr><th scope="row">Odds quotes / predictions</th><td className="num">{count(pipeline.inventory.quotes)} / {count(pipeline.inventory.predictions)}</td></tr>
                <tr><th scope="row">Model runs</th><td className="num">{count(pipeline.inventory.modelRuns)}</td></tr>
                <tr className={pipeline.overdueResults > 0 ? "attention" : undefined}><th scope="row">Results overdue</th><td className="num">{count(pipeline.overdueResults)} fixtures still open {pipeline.overdueResultHours}h+ after kickoff</td></tr>
                <tr className={pipeline.unsettledLocked > 0 ? "attention" : undefined}><th scope="row">Locked, unsettled tickets</th><td className="num">{count(pipeline.unsettledLocked)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="matches-table-wrap">
          <table className="analysis-table">
            <caption>Jobs · last {pipeline.jobHistoryDays} days</caption>
            <thead><tr><th scope="col">Job</th><th scope="col">Latest status</th><th scope="col">Run after</th><th scope="col">Attempts</th><th scope="col">Last completed</th><th scope="col">Done / runs</th><th scope="col">Last error</th></tr></thead>
            <tbody>{pipeline.jobHealth.length === 0 ? <tr><td colSpan={7}>No job runs recorded in this window.</td></tr> : pipeline.jobHealth.map((job) => <tr key={job.jobType} className={job.latestStatus !== "DONE" && job.lastError ? "attention" : undefined}>
              <th scope="row">{label(job.jobType)}</th>
              <td><span className={`status-badge ${job.latestStatus === "DONE" ? "win" : job.latestStatus === "FAILED" || job.lastError ? "loss" : "pending"}`}>{job.latestStatus}</span></td>
              <td className="num">{when(job.latestRunAfter)}</td>
              <td className="num">{job.latestAttempts}</td>
              <td className="num">{when(job.lastCompletedAt)}</td>
              <td className="num">{job.done} / {job.runs}</td>
              <td className="analysis-error">{!job.lastError ? "—" : job.latestStatus === "DONE" ? <small>Earlier attempt: {job.lastError}</small> : job.lastError}</td>
            </tr>)}</tbody>
          </table>
        </div>

        <div className="matches-table-wrap">
          <table className="analysis-table">
            <caption>API-Football quota · last 7 days used</caption>
            <thead><tr><th scope="col">Day (UTC)</th><th scope="col">Requests</th><th scope="col">Quota</th><th scope="col">Safety limit</th><th scope="col">Used of limit</th><th scope="col">Degraded</th></tr></thead>
            <tbody>{pipeline.quota.length === 0 ? <tr><td colSpan={6}>No API usage recorded.</td></tr> : pipeline.quota.map((row) => {
              const limit = Math.floor(row.quotaLimit * row.safetyPercent / 100);
              return <tr key={row.id} className={row.degradedAt ? "attention" : undefined}>
                <th scope="row">{row.usageDate.toISOString().slice(0, 10)}</th>
                <td className="num">{count(row.requestCount)}</td>
                <td className="num">{count(row.quotaLimit)}</td>
                <td className="num">{count(limit)} ({row.safetyPercent}%)</td>
                <td className="num">{pct(limit > 0 ? row.requestCount / limit : null, 0)}</td>
                <td>{row.degradedAt ? `Yes, ${when(row.degradedAt)}` : "No"}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      <section id="funnel" className="analysis-section" aria-labelledby="funnel-title">
        <h2 id="funnel-title">Next {funnel.windowHours}h funnel</h2>
        <p className="meta">How today&apos;s selection window narrows through each gate, measured now. A fixture needs both a prediction and a fresh price before it can become a candidate leg; the odds, EV and confidence gates then apply per selection.</p>
        <ol className="analysis-funnel">
          {funnel.steps.map((step) => <li key={step.label}>
            <div className="analysis-funnel-label"><strong>{step.label}</strong><small>{step.note}</small></div>
            <div className="analysis-funnel-bar" aria-hidden="true"><span style={{ width: `${Math.max(step.count > 0 ? 1.5 : 0, step.count / funnelMax * 100)}%` }} /></div>
            <span className="analysis-funnel-count">{count(step.count)}</span>
          </li>)}
        </ol>
      </section>

      <section id="model" className="analysis-section" aria-labelledby="model-title">
        <h2 id="model-title">Model coverage</h2>
        <p className="meta">Latest fitted parameters per competition ({model.methods.join(", ") || "no method recorded"}). Home advantage is the multiplier on the home side&apos;s expected goals; 1.00 means none.</p>
        <div className="analysis-kpis compact">
          <article><small>Competitions</small><strong>{count(model.competitions)}</strong><span>{count(model.stale)} stale (&gt; {model.staleBeforeHours}h)</span></article>
          <article><small>Home advantage</small><strong>{num(model.medianHomeAdvantage)}</strong><span>median · range {num(model.minHomeAdvantage)}–{num(model.maxHomeAdvantage)}</span></article>
          <article><small>Goals per team-match</small><strong>{num(model.medianLeagueAverageGoals)}</strong><span>median league average</span></article>
          <article><small>Matches / teams</small><strong>{num(model.medianMatches, 0)} / {num(model.medianTeams, 0)}</strong><span>median per competition</span></article>
          <article><small>Trained through</small><strong>{model.newestTrainedUntil ? ago(model.newestTrainedUntil, now) : "—"}</strong><span>oldest {model.oldestTrainedUntil ? ago(model.oldestTrainedUntil, now) : "—"}</span></article>
        </div>
        {model.largest.length === 0 ? <div className="notice">No competition has a trained model yet. TRAIN_MODEL needs {LEAGUE_MIN_MATCHES} finished matches in the last {HISTORY_LOOKBACK_DAYS} days.</div> : <div className="matches-table-wrap">
          <table className="analysis-table">
            <caption>Largest {model.largest.length} of {count(model.competitions)} modelled competitions, by training matches</caption>
            <thead><tr><th scope="col">Competition</th><th scope="col">Matches</th><th scope="col">Teams</th><th scope="col">Home adv.</th><th scope="col">League avg goals</th><th scope="col">Trained through</th></tr></thead>
            <tbody>{model.largest.map((row) => {
              const stale = now.getTime() - row.trainedUntil.getTime() > model.staleBeforeHours * 3600000;
              return <tr key={row.competitionId} className={stale ? "attention" : undefined}>
                <th scope="row">{row.name}{row.country ? <small> · {row.country}</small> : null}</th>
                <td className="num">{count(row.matches)}</td>
                <td className="num">{count(row.teams)}</td>
                <td className="num">{num(row.homeAdvantage)}</td>
                <td className="num">{num(row.leagueAverageGoals)}</td>
                <td className="num">{when(row.trainedUntil)}{stale ? " · stale" : ""}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
      </section>

      <section id="calibration" className="analysis-section" aria-labelledby="calibration-title">
        <h2 id="calibration-title">Calibration</h2>
        <p className="meta">Showing <strong>{period}</strong>. Calibration uses fixtures kicking off in these days (Blantyre time); ticket figures use the tickets&apos; UTC target dates. Walk-forward rules match the Results page: the latest forecast per selection, made before kickoff by a model trained no later. {count(calibration.excluded)} rows were excluded as late, look-ahead or unresolvable.</p>
        {calibration.scored === 0 ? <div className="notice">No finished fixtures with a walk-forward prediction in {period}. Calibration appears once predicted fixtures finish.</div> : <>
          <div className="matches-table-wrap">
            <table className="analysis-table">
              <caption>Scores by market</caption>
              <thead><tr><th scope="col">Market</th><th scope="col">Fixtures</th><th scope="col">Forecasts</th><th scope="col">Brier</th><th scope="col">Log-loss</th><th scope="col">Top pick hit rate</th></tr></thead>
              <tbody>{calibration.byMarket.map((row) => <tr key={row.market} className={row.market === "ALL" ? "total" : undefined}>
                <th scope="row">{row.market === "ALL" ? "All markets" : label(row.market)}</th>
                <td className="num">{count(row.fixtures)}</td>
                <td className="num">{count(row.predictions)}</td>
                <td className="num">{row.brier.toFixed(4)}</td>
                <td className="num">{row.logLoss.toFixed(4)}</td>
                <td className="num">{pct(row.pickAccuracy)} <small>({count(row.pickHits)})</small></td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="meta">Brier and log-loss are per selection; lower is better. For reference, always forecasting 50% on a two-way market scores a Brier of 0.25.</p>

          <div className="matches-table-wrap">
            <table className="analysis-table">
              <caption>Bias by selection</caption>
              <thead><tr><th scope="col">Market</th><th scope="col">Selection</th><th scope="col">Forecasts</th><th scope="col">Mean predicted</th><th scope="col">Observed</th><th scope="col">Bias</th></tr></thead>
              <tbody>{calibration.bySelection.map((row) => <tr key={`${row.market}-${row.selection}`}>
                <th scope="row">{label(row.market)}</th>
                <td>{label(row.selection)}</td>
                <td className="num">{count(row.predictions)}</td>
                <td className="num">{pct(row.meanPredicted)}</td>
                <td className="num">{pct(row.observedRate)}</td>
                <td className={`num ${Math.abs(row.bias) >= 0.03 ? "analysis-bias" : ""}`}>{signedPp(row.bias)}{Math.abs(row.bias) >= 0.03 ? (row.bias > 0 ? " · overrated" : " · underrated") : ""}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="meta">Bias is mean predicted minus observed rate, in percentage points. Gaps of 3 pp or more are labelled.</p>

          <div className="analysis-split reliability">
            <figure className="analysis-figure">
              <ReliabilityChart buckets={calibration.buckets} />
              <figcaption>Each dot is one probability bucket; larger dots hold more forecasts. Dots above the diagonal mean the outcome happened more often than predicted.</figcaption>
            </figure>
            <div className="matches-table-wrap">
              <table className="analysis-table">
                <caption>Reliability by probability bucket</caption>
                <thead><tr><th scope="col">Bucket</th><th scope="col">Forecasts</th><th scope="col">Predicted</th><th scope="col">Observed</th><th scope="col">Gap</th></tr></thead>
                <tbody>{calibration.buckets.map((bucket) => <tr key={bucket.lower}>
                  <th scope="row">{pct(bucket.lower, 0)}–{pct(bucket.upper, 0)}</th>
                  <td className="num">{count(bucket.predictions)}</td>
                  <td className="num">{pct(bucket.meanPredicted)}</td>
                  <td className="num">{pct(bucket.observedRate)}</td>
                  <td className="num">{bucket.meanPredicted === null || bucket.observedRate === null ? "—" : signedPp(bucket.observedRate - bucket.meanPredicted)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </div>
        </>}
      </section>

      <section id="tickets" className="analysis-section" aria-labelledby="tickets-title">
        <h2 id="tickets-title">Ticket performance</h2>
        <p className="meta">Current (non-superseded) ticket versions targeted in <strong>{period}</strong>. Expected hit rate is the model&apos;s own win probability for the same decided tickets or legs; a hit rate well below it means the model is overconfident on what it publishes.</p>
        {tickets.tickets === 0 ? <div className="notice">No paper tickets were published for {period}.</div> : <>
          <div className="matches-table-wrap">
            <table className="analysis-table">
              <caption>By tier</caption>
              <thead><tr><th scope="col">Tier</th><th scope="col">Published</th><th scope="col">W / L / V / pending</th><th scope="col">Hit rate</th><th scope="col">Expected</th><th scope="col">Profit (units)</th><th scope="col">ROI</th><th scope="col">Avg legs</th><th scope="col">Avg odds</th><th scope="col">Relaxed</th></tr></thead>
              <tbody>{tickets.tiers.map((tier) => <tr key={tier.tier}>
                <th scope="row">{tier.tier}</th>
                <td className="num">{count(tier.published)}</td>
                <td className="num">{tier.wins} / {tier.losses} / {tier.voids} / {tier.pending}</td>
                <td className="num">{pct(tier.hitRate)}</td>
                <td className="num">{pct(tier.expectedHitRate)}</td>
                <td className={`num ${tier.profitUnits > 0 ? "positive" : tier.profitUnits < 0 ? "negative" : ""}`}>{tier.settled ? tier.profitUnits.toFixed(2) : "—"}</td>
                <td className="num">{tier.roiPercent === null ? "—" : `${tier.roiPercent.toFixed(1)}%`}</td>
                <td className="num">{num(tier.avgLegs, 1)}</td>
                <td className="num">{num(tier.avgCombinedOdds)}</td>
                <td className="num">{pct(tier.relaxedShare, 0)}</td>
              </tr>)}</tbody>
            </table>
          </div>

          <div className="matches-table-wrap">
            <table className="analysis-table">
              <caption>Legs by market</caption>
              <thead><tr><th scope="col">Market</th><th scope="col">Legs</th><th scope="col">W / L / V / pending</th><th scope="col">Hit rate</th><th scope="col">Expected</th><th scope="col">Avg odds</th><th scope="col">Avg model edge</th><th scope="col">Avg confidence</th></tr></thead>
              <tbody>{tickets.markets.map((row) => <tr key={row.market} className={row.market === "ALL" ? "total" : undefined}>
                <th scope="row">{row.market === "ALL" ? "All markets" : label(row.market)}</th>
                <td className="num">{count(row.legs)}</td>
                <td className="num">{row.wins} / {row.losses} / {row.voids} / {row.pending}</td>
                <td className="num">{pct(row.hitRate)}</td>
                <td className="num">{pct(row.expectedHitRate)}</td>
                <td className="num">{num(row.avgOdds)}</td>
                <td className="num">{row.avgEdgePercent === null ? "—" : `${row.avgEdgePercent.toFixed(1)}%`}</td>
                <td className="num">{num(row.avgConfidence, 0)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="meta">Model edge is probability × odds − 1 before the {pct(EV_HAIRCUT, 0)} haircut. Confidence thresholds used: {tickets.thresholds.map((row) => `${row.threshold} (${row.count})`).join(", ")}. Average closing-line value on settled legs: {tickets.clv === null ? "—" : `${tickets.clv.toFixed(2)}%`}.</p>
        </>}
      </section>
    </section>
  );
}
