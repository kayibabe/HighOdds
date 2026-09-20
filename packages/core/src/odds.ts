import type { Quote } from "./types.js";

export const MIN_LEG_ODDS = 1.8;

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

export function conservativeExpectedValue(modelProbability: number, decimalOdds: number, haircut = 0.02): number {
  if (modelProbability < 0 || modelProbability > 1) throw new Error("Probability must be between 0 and 1");
  if (haircut < 0 || haircut >= 1) throw new Error("Haircut must be in [0, 1)");
  return modelProbability * (1 - haircut) * decimalOdds - 1;
}

export function quoteIsFresh(quote: Pick<Quote, "capturedAt">, kickoff: Date, now: Date, maxAgeMinutes = 180): boolean {
  const ageMs = now.getTime() - quote.capturedAt.getTime();
  return quote.capturedAt < kickoff && ageMs >= 0 && ageMs <= maxAgeMinutes * 60_000;
}
