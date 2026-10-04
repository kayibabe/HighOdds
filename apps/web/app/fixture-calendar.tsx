import Link from "next/link";
import { SELECTION_WINDOW_HOURS } from "@highodds/core";
import { loadFixtureCalendar } from "../lib/fixture-calendar";
import { formatDay } from "./date-nav";

export async function FixtureCalendar({ now, basePath, selectedDay, params = {} }: {
  now: Date; basePath: string; selectedDay?: string | null; params?: Record<string, string>;
}) {
  const calendar = await loadFixtureCalendar(now);
  return <section aria-label="Seven-day fixture calendar">
    <h2>Next 7 days</h2>
    <nav className="date-nav-row date-jumps" aria-label="Upcoming match dates">
      {calendar.days.map(({ day, count }) => <Link key={day} className={`date-chip${selectedDay === day ? " active" : ""}`}
        href={`${basePath}?${new URLSearchParams({ ...params, date: day })}`} aria-current={selectedDay === day ? "page" : undefined}>
        {formatDay(day)} · {count} matches
      </Link>)}
    </nav>
    <p className="meta">Today and the following six days · Malawi time. {calendar.completed === calendar.expected ? "Calendar refresh complete." : `Calendar refresh pending: ${calendar.completed}/${calendar.expected} date requests complete; counts may be incomplete.`}
      {calendar.lastCompletedAt && ` Last successful pull: ${new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Blantyre", dateStyle: "medium", timeStyle: "short" }).format(calendar.lastCompletedAt)}.`}
      {` Tomorrow's preliminary forecasts run at 22:00 Malawi time. Morning refresh: 07:45–08:00. Paper tickets retain the ${SELECTION_WINDOW_HOURS}-hour window and fresh-odds checks; later fixtures may have no forecast or odds yet.`}
    </p>
  </section>;
}
