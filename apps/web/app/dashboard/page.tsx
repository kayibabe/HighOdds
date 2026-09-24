import { redirect } from "next/navigation";
import { db } from "@highodds/db";
import { auth } from "../../auth";
import { blantyreDayBounds, legOutcome, parseIsoDay, strongestPrediction, utcDate, utcToday, type StoredPrediction } from "@highodds/core";
import { LEG_OUTCOME_LABEL, shortPickLabel } from "../../lib/selection";
import { loadTicketCards } from "../../lib/tickets";
import { DayNav, formatDay } from "../date-nav";
import TicketBoard from "./ticket-board";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = { STANDARD: "Standard", VALUE: "Value", HIGH: "High" };

const BLANTYRE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Blantyre", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
const BLANTYRE_RECEIVED = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Blantyre", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const { date } = await searchParams;
  // Ticket target dates are UTC days (matching the publish schedule); fixtures use the same day in Blantyre time.
  const today = utcToday(new Date());
  const day = parseIsoDay(date) ?? today;
  const isToday = day === today;
  const localDay = blantyreDayBounds(day);

  const [cardData, fixtures] = await Promise.all([
    loadTicketCards({ targetDate: utcDate(day) }),
    db.fixture.findMany({
      where: { kickoff: { gte: localDay.start, lt: localDay.end } },
      orderBy: [{ kickoff: "asc" }, { id: "asc" }],
      select: { id: true, kickoff: true, status: true, homeGoals: true, awayGoals: true, receivedAt: true, competition: { select: { name: true } }, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } }
    })
  ]);

  const fixtureIds = fixtures.map((fixture) => fixture.id);
  const [predictions, ticketLegs] = fixtureIds.length === 0 ? [[], []] : await Promise.all([
    db.prediction.findMany({
      where: { fixtureId: { in: fixtureIds } },
      select: { fixtureId: true, selection: true, probability: true, asOfAt: true, market: { select: { normalizedKey: true } } }
    }),
    db.ticketLeg.findMany({
      where: { fixtureId: { in: fixtureIds }, ticketVersion: { successors: { none: {} } } },
      select: { fixtureId: true, marketKey: true, selection: true, ticketVersion: { select: { tier: true } } }
    })
  ]);
  const predictionsByFixture = new Map<string, StoredPrediction[]>();
  for (const row of predictions) {
    const list = predictionsByFixture.get(row.fixtureId) ?? [];
    list.push({ marketKey: row.market.normalizedKey, selection: row.selection, probability: Number(row.probability), asOfAt: row.asOfAt });
    predictionsByFixture.set(row.fixtureId, list);
  }
  const legsByFixture = new Map<string, typeof ticketLegs>();
  for (const leg of ticketLegs) legsByFixture.set(leg.fixtureId, [...(legsByFixture.get(leg.fixtureId) ?? []), leg]);
  const pickCount = fixtures.filter((fixture) => predictionsByFixture.has(fixture.id)).length;

  return (
    <section>
      <p className="eyebrow">{isToday ? "TODAY'S RESEARCH" : "RESEARCH HISTORY"}</p>
      <h1>Dashboard</h1>
      <DayNav basePath="/dashboard" day={day} today={today} />
      <p>Selections that met the evidence bar for <strong>{formatDay(day)}</strong> (UTC day, matching the publish schedule). Nothing appears here on days without a qualifying edge.</p>
      <p><a href="#matches-title">View {fixtures.length} matches for {day} (Blantyre time)</a></p>

      {cardData.length === 0 && <div className="notice">{isToday ? "No qualified selections today. Insufficient evidence to publish a paper ticket." : `No paper ticket was published for ${formatDay(day)}.`}</div>}
      <TicketBoard tickets={cardData} />

      <section className="matches-section" aria-labelledby="matches-title">
        <h2 id="matches-title">{isToday ? "Today's matches" : `Matches on ${formatDay(day)}`}</h2>
        <p>{fixtures.length} fixtures scheduled for {day} in Africa/Blantyre. Times are local. <strong>Model pick</strong> is the model&apos;s most confident pre-kickoff call ({pickCount} of {fixtures.length} matches had a prediction; only competitions with a trained model get one) — a research signal, not a betting selection. <strong>Ticket</strong> shows the selection actually published on a paper ticket.</p>
        {fixtures.length === 0 ? <div className="notice">{isToday ? "No fixtures have been stored for today yet." : "No fixtures were stored for this day."}</div> : (
          <div className="matches-table-wrap">
            <table className="matches-table">
              <thead><tr><th>Time</th><th>Match</th><th>Competition</th><th>Status</th><th>Score</th><th>Model pick</th><th>Ticket</th><th>Last received</th></tr></thead>
              <tbody>{fixtures.map((fixture) => {
                const pick = strongestPrediction(predictionsByFixture.get(fixture.id) ?? [], fixture.kickoff);
                const pickOutcome = pick ? legOutcome(pick.marketKey!, pick.selection, fixture) : null;
                const legs = legsByFixture.get(fixture.id) ?? [];
                return (
                  <tr key={fixture.id}>
                    <td>{BLANTYRE_TIME.format(fixture.kickoff)}</td>
                    <td><a href={`/research?date=${day}&fixture=${fixture.id}`}>{fixture.homeTeam.name} vs {fixture.awayTeam.name}</a></td>
                    <td>{fixture.competition.name}</td>
                    <td>{fixture.status}</td>
                    <td>{fixture.homeGoals !== null && fixture.awayGoals !== null ? `${fixture.homeGoals}–${fixture.awayGoals}` : "—"}</td>
                    <td className="match-pick">{pick ? <>
                      <span>{shortPickLabel(pick.marketKey!, pick.selection)} <small>{(pick.probability * 100).toFixed(0)}%</small></span>
                      {pickOutcome && pickOutcome !== "PENDING" && <span className={`status-badge leg-outcome ${pickOutcome.toLowerCase()}`}>{LEG_OUTCOME_LABEL[pickOutcome]}</span>}
                    </> : <span className="match-pick-none">—</span>}</td>
                    <td className="match-pick">{legs.length === 0 ? <span className="match-pick-none">—</span> : legs.map((leg) => {
                      const outcome = legOutcome(leg.marketKey, leg.selection, fixture);
                      return <span key={`${leg.ticketVersion.tier}-${leg.marketKey}`} className="match-ticket-leg">
                        <span>{TIER_LABEL[leg.ticketVersion.tier] ?? leg.ticketVersion.tier}: {shortPickLabel(leg.marketKey, leg.selection)}</span>
                        {outcome !== "PENDING" && <span className={`status-badge leg-outcome ${outcome.toLowerCase()}`}>{LEG_OUTCOME_LABEL[outcome]}</span>}
                      </span>;
                    })}</td>
                    <td>{BLANTYRE_RECEIVED.format(fixture.receivedAt)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        <p className="meta">Fixture status is refreshed by the scheduled ingestion job; it is not a live score feed.</p>
      </section>
    </section>
  );
}
