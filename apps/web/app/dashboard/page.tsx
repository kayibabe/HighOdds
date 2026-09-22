import { redirect } from "next/navigation";
import { db } from "@highodds/db";
import { auth } from "../../auth";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = { STANDARD: "Standard", VALUE: "Value", HIGH: "High" };

function fmtTime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const today = new Date().toISOString().slice(0, 10);
  const targetDate = new Date(`${today}T00:00:00.000Z`);

  const tickets = await db.ticketVersion.findMany({
    where: { targetDate, successors: { none: {} } },
    orderBy: { tier: "asc" },
    include: { legs: { include: { fixture: { include: { homeTeam: true, awayTeam: true } } } }, settlements: true }
  });

  const markets = await db.market.findMany({ where: { normalizedKey: { not: null } }, select: { normalizedKey: true, name: true } });
  const marketNameByKey = new Map(markets.map((market) => [market.normalizedKey!, market.name]));

  return (
    <section>
      <p className="eyebrow">TODAY&apos;S RESEARCH</p>
      <h1>Dashboard</h1>
      <p>Selections that met the evidence bar for {today} (UTC day, matching the publish schedule). Nothing appears here on days without a qualifying edge.</p>

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
            <p className="meta">Published {fmtTime(ticket.publishedAt)} &middot; {ticket.settlements[0]?.outcome ?? "PENDING"}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
