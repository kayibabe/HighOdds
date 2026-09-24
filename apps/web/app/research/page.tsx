import Link from "next/link";
import { db } from "@highodds/db";
import { blantyreDayBounds, blantyreToday, evidenceLegOutcome, legOutcome, parseIsoDay, parseSettlementEvidence, resolveSelection } from "@highodds/core";
import { DayNav, formatDay } from "../date-nav";

export const dynamic = "force-dynamic";

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const dateTime = (value: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Blantyre", dateStyle: "medium", timeStyle: "short" }).format(value);
const label = (value: string) => value.replaceAll("_", " ");
const score = (fixture: { homeGoals: number | null; awayGoals: number | null }) => fixture.homeGoals !== null && fixture.awayGoals !== null ? `${fixture.homeGoals}–${fixture.awayGoals}` : null;
const LEG_OUTCOME_LABEL: Record<string, string> = { WIN: "Won", LOSS: "Lost", VOID: "Void", PENDING: "Pending", UNRESOLVED: "Unresolved" };

const fixtureInclude = {
  competition: true, homeTeam: true, awayTeam: true,
  predictions: { orderBy: { asOfAt: "desc" as const }, include: { market: true, modelRun: true } },
  quotes: { orderBy: { capturedAt: "desc" as const }, take: 100, include: { bookmaker: true, market: true } }
};

function resultHeadline(fixture: { status: string; statusCode: string | null; elapsedMinute: number | null; homeGoals: number | null; awayGoals: number | null }): string {
  const line = score(fixture);
  if (fixture.status === "FINISHED") return line ? `Full time · ${line}` : "Finished · score not recorded";
  if (fixture.status === "LIVE") return `In play${fixture.elapsedMinute === null ? "" : ` · ${fixture.elapsedMinute}′`}${line ? ` · ${line}` : ""}`;
  if (fixture.status === "POSTPONED") return "Postponed · markets void";
  if (fixture.status === "CANCELLED") return "Cancelled · markets void";
  return "Not started";
}

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ fixture?: string | string[]; date?: string | string[] }> }) {
  const { fixture: fixtureParam, date } = await searchParams;
  const fixtureId = typeof fixtureParam === "string" ? fixtureParam : undefined;
  const now = new Date();
  const today = blantyreToday(now);
  const day = parseIsoDay(date);

  // Without a date: the upcoming slate (as before). With a date: every researched fixture that day,
  // including ones that only appear on tickets, so past results stay reachable.
  const fixtures = await db.fixture.findMany({
    where: day
      ? { kickoff: { gte: blantyreDayBounds(day).start, lt: blantyreDayBounds(day).end }, OR: [{ predictions: { some: {} } }, { ticketLegs: { some: {} } }] }
      : { kickoff: { gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) }, predictions: { some: {} } },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }], take: day ? 200 : 80,
    include: fixtureInclude
  });
  const selected = fixtures.find((fixture) => fixture.id === fixtureId)
    ?? (fixtureId ? await db.fixture.findUnique({ where: { id: fixtureId }, include: fixtureInclude }) : null)
    ?? fixtures[0];

  const probabilityGroups = selected?.predictions.reduce((groups, prediction) => {
    const key = prediction.market.normalizedKey ?? prediction.market.name;
    const rows = groups.get(key) ?? [];
    if (!rows.some((row) => row.selection === prediction.selection)) rows.push(prediction);
    groups.set(key, rows);
    return groups;
  }, new Map<string, NonNullable<typeof selected>["predictions"]>());

  const finalScore = selected?.status === "FINISHED" && selected.homeGoals !== null && selected.awayGoals !== null
    ? { home: selected.homeGoals, away: selected.awayGoals } : null;
  const marketResults = Array.from(probabilityGroups?.entries() ?? []).map(([market, rows]) => {
    const outcomes = rows.map((row) => ({ row, hit: finalScore ? resolveSelection(market, row.selection, finalScore.home, finalScore.away) === "WIN" : null }));
    const pick = rows.reduce<(typeof rows)[number] | undefined>((best, row) => !best || Number(row.probability) > Number(best.probability) ? row : best, undefined);
    const resolvable = outcomes.every((item) => item.hit !== null) && outcomes.some((item) => item.hit);
    const brier = finalScore && resolvable ? outcomes.reduce((sum, item) => sum + (Number(item.row.probability) - Number(item.hit)) ** 2, 0) / outcomes.length : null;
    return { market, rows, outcomes, pick, pickHit: pick ? outcomes.find((item) => item.row === pick)?.hit ?? null : null, brier, winner: outcomes.find((item) => item.hit)?.row ?? null };
  });

  const ticketLegs = selected ? await db.ticketLeg.findMany({
    where: { fixtureId: selected.id, ticketVersion: { successors: { none: {} } } },
    include: { ticketVersion: { include: { settlements: true } } },
    orderBy: { ticketVersion: { tier: "asc" } }
  }) : [];

  const listHref = (id: string) => day ? `/research?date=${day}&fixture=${id}` : `/research?fixture=${id}`;

  return <section>
    <p className="eyebrow">FIXTURE RESEARCH</p>
    <h1>Research workspace</h1>
    <p>Model probabilities, locally captured pre-kickoff prices, and the recorded result. A displayed probability is a model estimate, not a validated edge or betting recommendation.</p>
    <DayNav basePath="/research" day={day} today={today} allowFuture upcomingLabel="Upcoming" />
    <p className="meta">{day ? `Fixtures on ${formatDay(day)} (Blantyre time) with a model forecast or a published ticket leg.` : "Upcoming and recently started fixtures with a model forecast. Pick a date to review past matches."}</p>
    {fixtures.length === 0 && !selected ? <div className="notice">{day ? `No researched fixtures on ${formatDay(day)}.` : "No scored fixtures are available yet. Predictions appear after the model and evidence gates pass."}</div> : <div className="research-layout">
      <nav className="research-fixtures" aria-label="Scored fixtures">
        {fixtures.length === 0 && <p className="meta">No other researched fixtures for this view.</p>}
        {fixtures.map((fixture) => <Link key={fixture.id} href={listHref(fixture.id)} className={`research-fixture${fixture.id === selected?.id ? " active" : ""}`}>
          <small>{dateTime(fixture.kickoff)} · {fixture.competition.name}</small><strong>{fixture.homeTeam.name} <span>vs</span> {fixture.awayTeam.name}</strong><small>{fixture.status}{score(fixture) ? ` · ${score(fixture)}` : ""}</small>
        </Link>)}
      </nav>
      {selected && <article className="research-detail">
        <p className="eyebrow">{selected.competition.name} · {dateTime(selected.kickoff)}</p>
        <h2>{selected.homeTeam.name} vs {selected.awayTeam.name}</h2>
        <p className="meta">Fixture status: {selected.status}{selected.statusCode ? ` (${selected.statusCode})` : ""}. Last received {dateTime(selected.receivedAt)}.</p>

        <section className="research-result" aria-labelledby="research-result-title">
          <h3 id="research-result-title">Match result</h3>
          <div className={`research-scoreboard status-${selected.status.toLowerCase()}`}>
            <span>{selected.homeTeam.name}</span>
            <strong>{score(selected) ?? "–"}</strong>
            <span>{selected.awayTeam.name}</span>
          </div>
          <p className="research-result-state">{resultHeadline(selected)}</p>
          {finalScore && marketResults.length > 0 && <div className="matches-table-wrap"><table className="matches-table">
            <thead><tr><th>Market</th><th>Result</th><th>Model pick</th><th>Model gave the result</th><th>Brier</th></tr></thead>
            <tbody>{marketResults.map((item) => <tr key={item.market}>
              <td>{label(item.market)}</td>
              <td>{item.winner ? label(item.winner.selection) : "Not resolvable"}</td>
              <td>{item.pick ? <>{label(item.pick.selection)} {item.pickHit === null ? null : <span className={`status-badge ${item.pickHit ? "win" : "loss"}`}>{item.pickHit ? "Hit" : "Miss"}</span>}</> : "—"}</td>
              <td>{item.winner ? pct(Number(item.winner.probability)) : "—"}</td>
              <td>{item.brier === null ? "—" : item.brier.toFixed(3)}</td>
            </tr>)}</tbody>
          </table></div>}
          {!finalScore && <p className="meta">{selected.status === "SCHEDULED" || selected.status === "LIVE" ? "Market results appear once the final score is stored." : "No final score is recorded; postponed and cancelled fixtures void every market."}</p>}
          {finalScore && <p className="meta">The model pick is the selection with the highest stored probability in each market. Brier is scored across that market&apos;s selections for this one match; lower is better and a single match is noisy.</p>}
        </section>

        {ticketLegs.length > 0 && <>
          <h3>On published tickets</h3>
          <div className="matches-table-wrap"><table className="matches-table">
            <thead><tr><th>Ticket</th><th>Selection</th><th>Odds</th><th>This leg</th><th>Ticket outcome</th></tr></thead>
            <tbody>{ticketLegs.map((leg) => {
              const settlement = leg.ticketVersion.settlements[0];
              const ticketOutcome = settlement?.outcome ?? "PENDING";
              const recorded = ticketOutcome !== "PENDING" ? parseSettlementEvidence(settlement?.evidence).find((row) => row.fixtureId === leg.fixtureId) : undefined;
              const outcome = recorded ? evidenceLegOutcome(recorded) : legOutcome(leg.marketKey, leg.selection, selected);
              const target = leg.ticketVersion.targetDate.toISOString().slice(0, 10);
              return <tr key={leg.id}>
                <td><Link href={`/results?from=${target}&to=${target}`}>{leg.ticketVersion.tier} · {target}</Link></td>
                <td>{label(leg.marketKey)}: {label(leg.selection)}</td>
                <td>{Number(leg.decimalOdds).toFixed(2)}</td>
                <td><span className={`status-badge ${outcome.toLowerCase()}`}>{LEG_OUTCOME_LABEL[outcome] ?? outcome}</span></td>
                <td><span className={`status-badge ${ticketOutcome.toLowerCase()}`}>{ticketOutcome}</span></td>
              </tr>;
            })}</tbody>
          </table></div>
        </>}

        <h3>Model probabilities</h3>
        {marketResults.length === 0 ? <p>No model forecast is stored for this fixture.</p> : <div className="research-probabilities">{marketResults.map(({ market, rows, outcomes }) => <div className="research-market" key={market}>
          <strong>{label(market)}</strong>
          <div>{outcomes.map(({ row, hit }) => <span key={`${row.modelRunId}-${row.selection}`} className={hit ? "research-hit" : undefined}><b>{label(row.selection)}{hit ? " ✓" : ""}</b>{pct(Number(row.probability))}</span>)}</div>
          <small>{rows[0] ? `${rows[0].modelRun.method} · trained through ${dateTime(rows[0].modelRun.trainedUntil)} · forecast ${dateTime(rows[0].asOfAt)}` : ""}</small>
        </div>)}</div>}
        <h3>Captured prices</h3>
        <p className="meta">Quotes are grouped by market and selection. Each record was captured before kickoff; this feed may be incomplete between provider snapshots.</p>
        {selected.quotes.length === 0 ? <p>No locally captured prices for this fixture.</p> : <div className="matches-table-wrap"><table className="matches-table"><thead><tr><th>Market</th><th>Selection</th><th>Bookmaker</th><th>Odds</th><th>Movement</th><th>Captured</th><th>Provider update</th></tr></thead><tbody>{selected.quotes.map((quote, index) => {
          const older = selected.quotes.slice(index + 1).find((candidate) => candidate.bookmakerId === quote.bookmakerId && candidate.marketId === quote.marketId && candidate.selection === quote.selection);
          const change = older ? (Number(quote.decimalOdds) - Number(older.decimalOdds)) / Number(older.decimalOdds) * 100 : null;
          return <tr key={quote.id}><td>{quote.market.normalizedKey ?? quote.market.name}</td><td>{quote.selection}</td><td>{quote.bookmaker.name}</td><td>{Number(quote.decimalOdds).toFixed(2)}</td><td>{change === null ? "First capture" : `${change > 0 ? "+" : ""}${change.toFixed(1)}% vs previous`}</td><td>{dateTime(quote.capturedAt)}</td><td>{quote.providerUpdatedAt ? dateTime(quote.providerUpdatedAt) : "Not supplied"}</td></tr>;
        })}</tbody></table></div>}
      </article>}
    </div>}
  </section>;
}
