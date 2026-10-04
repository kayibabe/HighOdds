import { addDays, blantyreDayBounds, blantyreToday } from "./dates.js";
import { FIXTURE_LOOKAHEAD_DAYS } from "./pipeline.js";

/** UTC request dates covering [start, end), including the UTC date before local midnight. */
export function providerDates(start: Date, end: Date): string[] {
  const dates: string[] = [];
  for (let date = start.toISOString().slice(0, 10); new Date(`${date}T00:00:00Z`) < end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

export function fixtureCalendar(now: Date) {
  const today = blantyreToday(now);
  const days = Array.from({ length: FIXTURE_LOOKAHEAD_DAYS }, (_, offset) => addDays(today, offset));
  const start = blantyreDayBounds(today).start;
  const end = blantyreDayBounds(days[days.length - 1]!).end;
  return { today, days, start, end, providerDates: providerDates(start, end) };
}
