import { redirect } from "next/navigation";
import { db } from "@highodds/db";
import { auth } from "../../auth";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = { STANDARD: "Standard", VALUE: "Value", HIGH: "High" };

function fmtTime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

const LOCAL_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Blantyre", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

function selectionLabel(selection: string): string {
  if (selection === "HOME") return "Home win";
  if (selection === "AWAY") return "Away win";
  if (selection === "DRAW") return "Draw";
  if (selection === "YES") return "Yes";
  if (selection === "NO") return "No";
  const total = /^(OVER|UNDER)_(\d+)_(\d+)$/.exec(selection);
  return total ? `${total[1] === "OVER" ? "Over" : "Under"} ${total[2]}.${total[3]}` : selection;
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

  return (
    <section>
      <p className="eyebrow">TODAY&apos;S RESEARCH</p>
      <h1>Dashboard</h1>
      <p>Selections that met the evidence bar for {today} (UTC day, matching the publish schedule). Nothing appears here on days without a qualifying edge.</p>
      <p><a href="#matches-title">View {fixtures.length} matches for {localDay.label} (Blantyre time)</a></p>

      {tickets.length === 0 && <div className="notice">No qualified selections today. Insufficient evidence to publish a paper ticket.</div>}

      <div className="ticket-cards">
        {tickets.map((ticket) => (
          <article key={ticket.id} className="ticket-card">
            <div className="ticket-card-head">
              <h2>{TIER_LABEL[ticket.tier] ?? ticket.tier}</h2>
              <span className="badge" aria-label={`Combined decimal odds ${Number(ticket.combinedOdds).toFixed(2)}`}>{Number(ticket.combinedOdds).toFixed(2)}×</span>
            </div>
            <p className="meta">
              Confidence &ge; {ticket.confidenceThreshold}%{ticket.relaxed && <span className="tag">relaxed criteria</span>} &middot; locks {fmtTime(ticket.lockAt)}
            </p>
            <div className="ticket-summary">
              <span><strong>{ticket.legs.length}</strong> legs</span>
              <span>Bookmaker <strong>{bookmakerNameById.get(ticket.bookmakerId) ?? "Recorded bookmaker"}</strong></span>
              <span className="ticket-paper-label">Paper research</span>
            </div>
            <ul className="legs" aria-label={`${TIER_LABEL[ticket.tier] ?? ticket.tier} ticket legs`}>
              {ticket.legs.map((leg) => (
                <li key={leg.id}>
                  <div className="leg-fixture">
                    <strong>{leg.fixture.homeTeam.name} vs {leg.fixture.awayTeam.name}</strong>
                    <small>{leg.fixture.competition.name} · {LOCAL_DATE_TIME.format(leg.fixture.kickoff)} CAT</small>
                  </div>
                  <div className="leg-pick">
                    <strong>{marketNameByKey.get(leg.marketKey) ?? leg.marketKey}: {selectionLabel(leg.selection)}</strong>
                    <small>Model estimate {(Number(leg.probability) * 100).toFixed(1)}% · {quoteTimeById.has(leg.quoteId) ? `Odds captured ${fmtTime(quoteTimeById.get(leg.quoteId)!)}` : "Quote time unavailable"}</small>
                  </div>
                  <strong className="leg-price">{Number(leg.decimalOdds).toFixed(2)}×</strong>
                </li>
              ))}
            </ul>
            <p className="meta ticket-footer">Published {fmtTime(ticket.publishedAt)} &middot; <span className={`status-badge ${(ticket.settlements[0]?.outcome ?? "PENDING").toLowerCase()}`}>{ticket.settlements[0]?.outcome ?? "PENDING"}</span></p>
          </article>
        ))}
      </div>

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
