import type { Quote } from "./types.js";

export const MIN_LEG_ODDS = 1.8;
/** Share of the model probability discarded before computing EV, as a margin for model error. */
export const EV_HAIRCUT = 0.02;
/** A quote older than this (or captured at/after kickoff) cannot back a ticket leg. */
export const QUOTE_MAX_AGE_MINUTES = 180;

export function impliedProbability(decimalOdds: number): number {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) throw new Error("Decimal odds must be greater than 1");
  return 1 / decimalOdds;
}

/** Removes a simple proportional bookmaker margin from outcomes in one market. */
export function devigProbability(decimalOdds: number, allOutcomeOdds: number[]): number {
  const overround = allOutcomeOdds.reduce((total, odds) => total + impliedProbability(odds), 0);
  if (overround <= 0) throw new Error("A market requires at least one valid outcome");
  return impliedProbability(decimalOdds) / overround;
}

export function conservativeExpectedValue(modelProbability: number, decimalOdds: number, haircut = EV_HAIRCUT): number {
  if (modelProbability < 0 || modelProbability > 1) throw new Error("Probability must be between 0 and 1");
  if (haircut < 0 || haircut >= 1) throw new Error("Haircut must be in [0, 1)");
  return modelProbability * (1 - haircut) * decimalOdds - 1;
}

export function quoteIsFresh(quote: Pick<Quote, "capturedAt">, kickoff: Date, now: Date, maxAgeMinutes = QUOTE_MAX_AGE_MINUTES): boolean {
  const ageMs = now.getTime() - quote.capturedAt.getTime();
  return quote.capturedAt < kickoff && ageMs >= 0 && ageMs <= maxAgeMinutes * 60_000;
}
