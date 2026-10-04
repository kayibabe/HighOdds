type QuoteLike = {
  selection: string;
  decimalOdds: unknown;
  capturedAt: Date;
  bookmaker: { name: string; priority: number; active?: boolean };
  market: { normalizedKey: string | null; name?: string };
};

export type QuoteResolutionMode = "forecast" | "historical";

/**
 * Resolve one auditable active-bookmaker quote for a market selection.
 * Forecasts use the first configured-priority quote captured after the forecast;
 * historical screening uses the highest available price, matching its discovery policy.
 */
export function resolveResearchQuote<T extends QuoteLike>(
  quotes: readonly T[],
  input: {
    marketKey: string;
    selection: string;
    kickoff: Date;
    forecastAt?: Date;
    maxQuoteAgeMinutes?: number;
    mode: QuoteResolutionMode;
  }
): T | null {
  const eligible = quotes.filter((quote) => {
    if (quote.bookmaker.active === false) return false;
    if ((quote.market.normalizedKey ?? quote.market.name) !== input.marketKey) return false;
    if (quote.selection !== input.selection || quote.capturedAt >= input.kickoff) return false;
    if (input.forecastAt && quote.capturedAt < input.forecastAt) return false;
    if (input.maxQuoteAgeMinutes && input.kickoff.getTime() - quote.capturedAt.getTime() > input.maxQuoteAgeMinutes * 60_000) return false;
    return true;
  });

  eligible.sort((left, right) => input.mode === "historical"
    ? Number(right.decimalOdds) - Number(left.decimalOdds) || left.bookmaker.priority - right.bookmaker.priority || right.capturedAt.getTime() - left.capturedAt.getTime()
    : left.bookmaker.priority - right.bookmaker.priority || left.capturedAt.getTime() - right.capturedAt.getTime());
  return eligible[0] ?? null;
}
