import { db } from "@highodds/db";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const tickets = await db.ticketVersion.findMany({ take: 20, orderBy: { publishedAt: "desc" }, include: { settlements: true } });
  return <section><p className="eyebrow">VERIFIED PAPER HISTORY</p><h1>Ticket outcomes</h1><p>Performance figures appear only after locally captured prices settle. Empty history is expected during setup.</p><ul className="tickets">{tickets.map((ticket) => <li key={ticket.id}><strong>{ticket.tier}</strong><span>{Number(ticket.combinedOdds).toFixed(2)}</span><span>{ticket.settlements[0]?.outcome ?? "PENDING"}</span></li>)}</ul>{tickets.length === 0 && <div className="notice">No published paper tickets yet.</div>}</section>;
}
