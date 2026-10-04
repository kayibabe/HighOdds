import { addDays, blantyreDayBounds, blantyreToday, parseIsoDay } from "./dates.js";
import { SELECTION_WINDOW_HOURS } from "./pipeline.js";

export type ForecastOptions = { stage?: "SELECTION" } | { stage: "PRELIMINARY"; targetDate: string };

/** Previews cover a full pinned local day; selection forecasts retain the existing 20h gate. */
export function predictionWindow(now: Date, options: ForecastOptions = {}) {
  if (options.stage === "PRELIMINARY") {
    const day = parseIsoDay(options.targetDate);
    if (!day) throw new Error("Invalid preliminary forecast target date");
    const { start, end } = blantyreDayBounds(day);
    return { gte: new Date(Math.max(now.getTime(), start.getTime())), lt: end };
  }
  return { gte: now, lte: new Date(now.getTime() + SELECTION_WINDOW_HOURS * 3_600_000) };
}

export function tomorrowForecastDate(now: Date): string {
  return addDays(blantyreToday(now), 1);
}

export function forecastStageLabel(stage?: string): string {
  return stage === "PRELIMINARY" ? "Preliminary" : "Selection-window forecast";
}
