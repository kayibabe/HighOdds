import { redirect } from "next/navigation";
import { auth } from "../../../auth";
import { blantyreToday, parseIsoDay, utcDate } from "@highodds/core";
import { loadTicketCards } from "../../../lib/tickets";
import { loadTotalGoalsRuleDay } from "../../../lib/total-goals";
import { loadDailyModelPicks } from "../../../lib/analysis";
import { DayNav, formatDay } from "../../date-nav";
import { FixtureCalendar } from "../../fixture-calendar";
import TicketBoard from "../ticket-board";
import TotalGoalsRule from "../total-goals-rule";
import ModelPicks from "../model-picks";

export const dynamic = "force-dynamic";

export default async function DailyResearchPage({ searchParams }: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");
  const { date } = await searchParams;
  const now = new Date();
  const today = blantyreToday(now);
  const day = parseIsoDay(date) ?? today;
  const [tickets, rule, picks] = await Promise.all([
    loadTicketCards({ targetDate: utcDate(day) }), loadTotalGoalsRuleDay(day), loadDailyModelPicks(day)
  ]);
  return <section>
    <p className="eyebrow">TODAY · PAPER RESEARCH</p>
    <h1>Today&apos;s Paper Tickets</h1>
    <DayNav basePath="/dashboard/research" day={day} today={today} allowFuture />
    <p className="page-intro">Published paper tickets for <strong>{formatDay(day)}</strong>. Supporting model signals remain available below; fixture times are Africa/Blantyre.</p>
    {!tickets.length && <div className="notice">No paper ticket was published for {formatDay(day)}. The signals below remain research evidence.</div>}
    <TicketBoard tickets={tickets} />
    <details className="secondary-evidence"><summary>Upcoming match calendar</summary>
      <FixtureCalendar now={now} basePath="/dashboard/high-probability" selectedDay={day} />
    </details>
    <details className="secondary-evidence"><summary>Supporting model signals and rules</summary>
      <TotalGoalsRule data={rule} /><ModelPicks day={day} picks={picks} />
    </details>
    <p><a href={`/dashboard/high-probability?date=${day}`}>Explore High Probability Matches for this date</a></p>
  </section>;
}
