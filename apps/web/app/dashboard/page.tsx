import { redirect } from "next/navigation";
import { db } from "@highodds/db";
import { auth } from "../../auth";
import { blantyreDayBounds, parseIsoDay, utcDate, utcToday } from "@highodds/core";
import { loadTicketCards } from "../../lib/tickets";
import { DayNav, formatDay } from "../date-nav";
import TicketBoard from "./ticket-board";

export const dynamic = "force-dynamic";

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
        <p>{fixtures.length} fixtures scheduled for {day} in Africa/Blantyre. Times are local. These are source fixtures, not betting selections.</p>
        {fixtures.length === 0 ? <div className="notice">{isToday ? "No fixtures have been stored for today yet." : "No fixtures were stored for this day."}</div> : (
          <div className="matches-table-wrap">
            <table className="matches-table">
              <thead><tr><th>Time</th><th>Match</th><th>Competition</th><th>Status</th><th>Score</th><th>Last received</th></tr></thead>
              <tbody>{fixtures.map((fixture) => (
                <tr key={fixture.id}>
                  <td>{BLANTYRE_TIME.format(fixture.kickoff)}</td>
                  <td><a href={`/research?date=${day}&fixture=${fixture.id}`}>{fixture.homeTeam.name} vs {fixture.awayTeam.name}</a></td>
                  <td>{fixture.competition.name}</td>
                  <td>{fixture.status}</td>
                  <td>{fixture.homeGoals !== null && fixture.awayGoals !== null ? `${fixture.homeGoals}–${fixture.awayGoals}` : "—"}</td>
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
