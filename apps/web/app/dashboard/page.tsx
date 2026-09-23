import { redirect } from "next/navigation";
import { db } from "@highodds/db";
import { auth } from "../../auth";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = { STANDARD: "Standard", VALUE: "Value", HIGH: "High" };

function fmtTime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
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
      include: { legs: { include: { fixture: { include: { homeTeam: true, awayTeam: true } } } }, settlements: true }
    }),
    db.fixture.findMany({
      where: { kickoff: { gte: localDay.start, lt: localDay.end } },
      orderBy: [{ kickoff: "asc" }, { id: "asc" }],
      select: { id: true, kickoff: true, status: true, receivedAt: true, competition: { select: { name: true } }, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } }
    })
  ]);

  const markets = await db.market.findMany({ where: { normalizedKey: { not: null } }, select: { normalizedKey: true, name: true } });
  const marketNameByKey = new Map(markets.map((market) => [market.normalizedKey!, market.name]));

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
              <span className="badge">{Number(ticket.combinedOdds).toFixed(2)}</span>
            </div>
            <p className="meta">
              Confidence &ge; {ticket.confidenceThreshold}%{ticket.relaxed && <span className="tag">relaxed criteria</span>} &middot; locks {fmtTime(ticket.lockAt)}
            </p>
            <ul className="legs">
              {ticket.legs.map((leg) => (
                <li key={leg.id}>
                  <span>{leg.fixture.homeTeam.name} vs {leg.fixture.awayTeam.name}</span>
                  <span>{marketNameByKey.get(leg.marketKey) ?? leg.marketKey}: {leg.selection}</span>
                  <span>{Number(leg.decimalOdds).toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <p className="meta">Published {fmtTime(ticket.publishedAt)} &middot; <span className={`status-badge ${(ticket.settlements[0]?.outcome ?? "PENDING").toLowerCase()}`}>{ticket.settlements[0]?.outcome ?? "PENDING"}</span></p>
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
