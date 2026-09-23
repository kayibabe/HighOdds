import { redirect } from "next/navigation";
import { db } from "@highodds/db";
import { auth } from "../../auth";
import TicketBoard, { type TicketCardData } from "./ticket-board";

export const dynamic = "force-dynamic";

type DecisionLeg = {
  fixtureId: string; market: string; selection: string; decimalOdds: number;
  modelProbability: number; consensusProbability: number; confidenceScore: number
};

function decisionLegs(value: unknown): DecisionLeg[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DecisionLeg => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return typeof row.fixtureId === "string" && typeof row.market === "string" && typeof row.selection === "string"
      && typeof row.decimalOdds === "number" && Number.isFinite(row.decimalOdds)
      && typeof row.modelProbability === "number" && row.modelProbability >= 0 && row.modelProbability <= 1
      && typeof row.consensusProbability === "number" && row.consensusProbability >= 0 && row.consensusProbability <= 1
      && typeof row.confidenceScore === "number" && row.confidenceScore >= 0 && row.confidenceScore <= 100;
  });
}

const BLANTYRE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Blantyre", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
const BLANTYRE_RECEIVED = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Blantyre", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

function blantyreDay(now: Date): { label: string; start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Blantyre", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const year = value("year");
  const month = value("month");
  const day = value("day");
  // Africa/Blantyre is UTC+02:00 year round.
  const start = new Date(Date.UTC(year, month - 1, day) - 2 * 60 * 60 * 1000);
  return { label: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const localDay = blantyreDay(now);
  const targetDate = new Date(`${today}T00:00:00.000Z`);

  const [tickets, fixtures] = await Promise.all([
    db.ticketVersion.findMany({
      where: { targetDate, successors: { none: {} } },
      orderBy: { tier: "asc" },
      include: { legs: { include: { fixture: { include: { competition: true, homeTeam: true, awayTeam: true } } } }, settlements: true }
    }),
    db.fixture.findMany({
      where: { kickoff: { gte: localDay.start, lt: localDay.end } },
      orderBy: [{ kickoff: "asc" }, { id: "asc" }],
      select: { id: true, kickoff: true, status: true, receivedAt: true, competition: { select: { name: true } }, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } }
    })
  ]);

  const markets = await db.market.findMany({ where: { normalizedKey: { not: null } }, select: { normalizedKey: true, name: true } });
  const marketNameByKey = new Map(markets.map((market) => [market.normalizedKey!, market.name]));
  const [bookmakers, quotes] = await Promise.all([
    db.bookmaker.findMany({ where: { id: { in: [...new Set(tickets.map((ticket) => ticket.bookmakerId))] } }, select: { id: true, name: true } }),
    db.oddsQuote.findMany({ where: { id: { in: tickets.flatMap((ticket) => ticket.legs.map((leg) => leg.quoteId)) } }, select: { id: true, capturedAt: true } })
  ]);
  const bookmakerNameById = new Map(bookmakers.map((bookmaker) => [bookmaker.id, bookmaker.name]));
  const quoteTimeById = new Map(quotes.map((quote) => [quote.id, quote.capturedAt]));
  const cardData: TicketCardData[] = tickets.map((ticket) => {
    const decisions = decisionLegs(ticket.decision);
    return {
      id: ticket.id, tier: ticket.tier, combinedOdds: Number(ticket.combinedOdds),
      confidenceThreshold: ticket.confidenceThreshold, relaxed: ticket.relaxed,
      publishedAt: ticket.publishedAt.toISOString(), lockAt: ticket.lockAt.toISOString(),
      bookmaker: bookmakerNameById.get(ticket.bookmakerId) ?? null,
      outcome: ticket.settlements[0]?.outcome ?? "PENDING",
      legs: ticket.legs.map((leg) => {
        const odds = Number(leg.decimalOdds);
        const probability = Number(leg.probability);
        const snapshot = decisions.find((item) => item.fixtureId === leg.fixtureId && item.market === leg.marketKey
          && item.selection === leg.selection && Math.abs(item.decimalOdds - odds) < 0.0001
          && Math.abs(item.modelProbability - probability) < 0.000001);
        return {
          id: leg.id, home: leg.fixture.homeTeam.name, away: leg.fixture.awayTeam.name,
          competition: leg.fixture.competition.name, kickoff: leg.fixture.kickoff.toISOString(),
          fixtureStatus: leg.fixture.status, homeGoals: leg.fixture.homeGoals, awayGoals: leg.fixture.awayGoals,
          market: marketNameByKey.get(leg.marketKey) ?? leg.marketKey, selection: leg.selection,
          odds, probability, quoteCapturedAt: quoteTimeById.get(leg.quoteId)?.toISOString() ?? null,
          consensusProbability: snapshot?.consensusProbability ?? null,
          agreementScore: snapshot?.confidenceScore ?? null
        };
      }).sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id))
    };
  });

  return (
    <section>
      <p className="eyebrow">TODAY&apos;S RESEARCH</p>
      <h1>Dashboard</h1>
      <p>Selections that met the evidence bar for {today} (UTC day, matching the publish schedule). Nothing appears here on days without a qualifying edge.</p>
      <p><a href="#matches-title">View {fixtures.length} matches for {localDay.label} (Blantyre time)</a></p>

      {tickets.length === 0 && <div className="notice">No qualified selections today. Insufficient evidence to publish a paper ticket.</div>}
      <TicketBoard tickets={cardData} />

      <section className="matches-section" aria-labelledby="matches-title">
        <h2 id="matches-title">Today&apos;s matches</h2>
        <p>{fixtures.length} fixtures scheduled for {localDay.label} in Africa/Blantyre. Times are local. These are source fixtures, not betting selections.</p>
        {fixtures.length === 0 ? <div className="notice">No fixtures have been stored for today yet.</div> : (
          <div className="matches-table-wrap">
            <table className="matches-table">
              <thead><tr><th>Time</th><th>Match</th><th>Competition</th><th>Status</th><th>Last received</th></tr></thead>
              <tbody>{fixtures.map((fixture) => (
                <tr key={fixture.id}>
                  <td>{BLANTYRE_TIME.format(fixture.kickoff)}</td>
                  <td>{fixture.homeTeam.name} vs {fixture.awayTeam.name}</td>
                  <td>{fixture.competition.name}</td>
                  <td>{fixture.status}</td>
                  <td>{BLANTYRE_RECEIVED.format(fixture.receivedAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="meta">Fixture status is refreshed by the scheduled ingestion job; it is not a live score feed.</p>
      </section>
    </section>
  );
}
