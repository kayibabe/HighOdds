/**
 * Calendar helpers for browsing history by day or range. Days are ISO "YYYY-MM-DD" strings so they
 * can travel in URLs unchanged. Ticket target dates are UTC calendar days (matching the publish
 * schedule); fixture lists use the Africa/Blantyre day, which is UTC+02:00 year round.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const BLANTYRE_OFFSET_MS = 2 * 60 * 60 * 1000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Returns the day if it is a real calendar date, otherwise null (rejects 2026-02-30, junk, arrays). */
export function parseIsoDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ISO_DAY.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? value : null;
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Midnight UTC of the day, the representation Prisma uses for @db.Date columns. */
export function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function utcToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** [start, end) instants of a local Africa/Blantyre calendar day. */
export function blantyreDayBounds(day: string): { start: Date; end: Date } {
  const start = new Date(Date.parse(`${day}T00:00:00.000Z`) - BLANTYRE_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function blantyreToday(now: Date): string {
  return new Date(now.getTime() + BLANTYRE_OFFSET_MS).toISOString().slice(0, 10);
}

export const RANGE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "365d", label: "Last year" },
  { key: "all", label: "All time" }
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]["key"];

/** Inclusive day range; null bounds mean open-ended ("all time"). */
export interface DayRange {
  preset: RangePreset | "custom";
  from: string | null;
  to: string | null;
}

export function presetRange(preset: RangePreset, today: string): DayRange {
  switch (preset) {
    case "today": return { preset, from: today, to: today };
    case "yesterday": return { preset, from: addDays(today, -1), to: addDays(today, -1) };
    case "7d": return { preset, from: addDays(today, -6), to: today };
    case "30d": return { preset, from: addDays(today, -29), to: today };
    case "365d": return { preset, from: addDays(today, -364), to: today };
    case "all": return { preset, from: null, to: null };
  }
}

/**
 * Resolves ?range=, ?from= and ?to= search params. Explicit dates win over a preset; a reversed
 * custom range is swapped rather than rejected. Anything invalid falls back to the default preset.
 */
export function resolveDayRange(params: { range?: unknown; from?: unknown; to?: unknown }, today: string, fallback: RangePreset = "30d"): DayRange {
  const from = parseIsoDay(params.from);
  const to = parseIsoDay(params.to);
  if (from || to) {
    const start = from ?? to!;
    const end = to ?? from!;
    return start <= end ? { preset: "custom", from: start, to: end } : { preset: "custom", from: end, to: start };
  }
  const preset = RANGE_PRESETS.find((item) => item.key === params.range)?.key ?? fallback;
  return presetRange(preset, today);
}
