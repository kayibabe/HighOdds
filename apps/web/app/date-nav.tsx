import Link from "next/link";
import { addDays, RANGE_PRESETS, type DayRange } from "@highodds/core";

// Server-rendered history navigation. Plain links and GET forms, so it works without client JS and
// every view has a shareable URL.

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });

export function formatDay(day: string): string {
  return DAY_LABEL.format(new Date(`${day}T00:00:00.000Z`));
}

function href(basePath: string, params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${basePath}?${text}` : basePath;
}

/** Single-day picker: previous/next day, a calendar input, and quick jumps back in time. */
export function DayNav({ basePath, day, today, allowFuture = false, upcomingLabel }: {
  basePath: string; day: string | null; today: string; allowFuture?: boolean;
  /** When set, the page has a non-dated default view (e.g. "Upcoming") that this link returns to. */
  upcomingLabel?: string;
}) {
  const current = day ?? today;
  const next = addDays(current, 1);
  const jumps = [
    { label: "Yesterday", day: addDays(today, -1) },
    { label: "1 week ago", day: addDays(today, -7) },
    { label: "1 month ago", day: addDays(today, -30) },
    { label: "1 year ago", day: addDays(today, -365) }
  ];
  return (
    <nav className="date-nav" aria-label="Choose a date">
      <div className="date-nav-row">
        <Link className="date-step" href={href(basePath, { date: addDays(current, -1) })} aria-label={`Previous day, ${formatDay(addDays(current, -1))}`}>‹</Link>
        <form className="date-form" action={basePath} method="get">
          <label className="sr-only" htmlFor={`${basePath}-date`}>Date</label>
          <input id={`${basePath}-date`} type="date" name="date" defaultValue={current} max={allowFuture ? undefined : today} required />
          <button type="submit" className="date-go">Go</button>
        </form>
        {allowFuture || next <= today
          ? <Link className="date-step" href={href(basePath, { date: next })} aria-label={`Next day, ${formatDay(next)}`}>›</Link>
          : <span className="date-step disabled" aria-hidden="true">›</span>}
        {upcomingLabel
          ? <Link className={`date-chip${day === null ? " active" : ""}`} href={basePath} aria-current={day === null ? "page" : undefined}>{upcomingLabel}</Link>
          : <Link className={`date-chip${current === today ? " active" : ""}`} href={basePath} aria-current={current === today ? "page" : undefined}>Today</Link>}
      </div>
      <div className="date-nav-row date-jumps">
        {jumps.map((jump) => (
          <Link key={jump.label} className={`date-chip${day === jump.day ? " active" : ""}`} href={href(basePath, { date: jump.day })} aria-current={day === jump.day ? "page" : undefined}>{jump.label}</Link>
        ))}
      </div>
    </nav>
  );
}

/** Range picker: preset periods plus a custom inclusive from/to range. */
export function RangeNav({ basePath, range, today }: { basePath: string; range: DayRange; today: string }) {
  return (
    <nav className="date-nav" aria-label="Choose a period">
      <div className="date-nav-row date-jumps">
        {RANGE_PRESETS.map((preset) => {
          const active = range.preset === preset.key;
          return <Link key={preset.key} className={`date-chip${active ? " active" : ""}`} href={href(basePath, { range: preset.key })} aria-current={active ? "page" : undefined}>{preset.label}</Link>;
        })}
      </div>
      <form className="date-form date-range-form" action={basePath} method="get">
        <label>From <input type="date" name="from" defaultValue={range.from ?? ""} max={today} /></label>
        <label>To <input type="date" name="to" defaultValue={range.to ?? ""} max={today} /></label>
        <button type="submit" className="date-go">Show</button>
      </form>
    </nav>
  );
}

export function rangeLabel(range: DayRange): string {
  if (!range.from || !range.to) return "all recorded history";
  return range.from === range.to ? formatDay(range.from) : `${formatDay(range.from)} – ${formatDay(range.to)}`;
}
