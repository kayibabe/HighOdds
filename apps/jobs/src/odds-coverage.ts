import { db } from "@highodds/db";
import { highProbabilityPick, SELECTION_WINDOW_HOURS, type StoredPrediction } from "@highodds/core";
import { ApiFootballClient } from "./api-football.js";
import { ingestOdds } from "./ingestion.js";
import { generatePredictions } from "./predict.js";

const SELECTION_WINDOW_MS = SELECTION_WINDOW_HOURS * 60 * 60 * 1000;
const MINIMUM_PROBABILITY_PERCENT = 50;

type CoveragePick = StoredPrediction & { trainedUntil: Date };

export type OddsCoverageTarget = {
  fixtureId: string;
  providerId: number;
  kickoff: Date;
  marketKey: string;
  selection: string;
  forecastAt: Date;
};

type CoverageQuote = {
  fixtureId: string;
  marketKey: string | null;
  selection: string;
  capturedAt: Date;
  active: boolean;
};

/** A price is usable only when it was observed after the forecast and before kickoff. */
export function missingOddsCoverageTargets(targets: OddsCoverageTarget[], quotes: CoverageQuote[]): OddsCoverageTarget[] {
  return targets.filter((target) => !quotes.some((quote) =>
    quote.fixtureId === target.fixtureId && quote.marketKey === target.marketKey && quote.selection === target.selection
    && quote.active && quote.capturedAt >= target.forecastAt && quote.capturedAt < target.kickoff
  ));
}

export interface OddsCoverageResult {
  forecasts: number;
  checked: number;
  retried: number;
  captured: number;
  rejected: number;
  remaining: number;
}

/**
 * Generates the forecast batch before a focused odds pass, then retries only the selected high
 * probability fixture/market/selection pairs that still lack a local active-bookmaker price.
 * A remaining gap means the provider or every active bookmaker had no eligible quote; it is kept
 * visible and is never filled using a post-kickoff or reconstructed price.
 */
export async function captureOddsCoverage(now: Date, client: ApiFootballClient): Promise<OddsCoverageResult> {
  const forecast = await generatePredictions(now);
  const windowEnd = new Date(now.getTime() + SELECTION_WINDOW_MS);
  const fixtures = await db.fixture.findMany({
    where: { status: "SCHEDULED", kickoff: { gte: now, lte: windowEnd } },
    select: { id: true, providerId: true, kickoff: true }
  });
  if (fixtures.length === 0) return { forecasts: forecast.predicted, checked: 0, retried: 0, captured: 0, rejected: 0, remaining: 0 };

  const predictions = await db.prediction.findMany({
    where: { stage: "SELECTION", fixtureId: { in: fixtures.map((fixture) => fixture.id) } },
    orderBy: [{ asOfAt: "desc" }, { id: "asc" }],
    select: { fixtureId: true, selection: true, probability: true, asOfAt: true, modelRun: { select: { trainedUntil: true } }, market: { select: { normalizedKey: true } } }
  });
  const predictionsByFixture = new Map<string, CoveragePick[]>();
  for (const prediction of predictions) {
    const rows = predictionsByFixture.get(prediction.fixtureId) ?? [];
    rows.push({ marketKey: prediction.market.normalizedKey, selection: prediction.selection, probability: Number(prediction.probability), asOfAt: prediction.asOfAt, trainedUntil: prediction.modelRun.trainedUntil });
    predictionsByFixture.set(prediction.fixtureId, rows);
  }
  const targets = fixtures.flatMap((fixture) => {
    const pick = highProbabilityPick(predictionsByFixture.get(fixture.id) ?? [], fixture.kickoff, now, MINIMUM_PROBABILITY_PERCENT);
    return pick?.marketKey ? [{ fixtureId: fixture.id, providerId: fixture.providerId, kickoff: fixture.kickoff, marketKey: pick.marketKey, selection: pick.selection, forecastAt: pick.asOfAt }] : [];
  });
  if (targets.length === 0) return { forecasts: forecast.predicted, checked: 0, retried: 0, captured: 0, rejected: 0, remaining: 0 };

  const loadQuotes = async (fixtureIds: string[]): Promise<CoverageQuote[]> => db.oddsQuote.findMany({
    where: { fixtureId: { in: fixtureIds } },
    select: { fixtureId: true, selection: true, capturedAt: true, bookmaker: { select: { active: true } }, market: { select: { normalizedKey: true } } }
  }).then((rows) => rows.map((quote) => ({ fixtureId: quote.fixtureId, selection: quote.selection, capturedAt: quote.capturedAt, active: quote.bookmaker.active, marketKey: quote.market.normalizedKey })));

  const missing = missingOddsCoverageTargets(targets, await loadQuotes(targets.map((target) => target.fixtureId)));
  let captured = 0;
  let rejected = 0;
  for (const target of missing) {
    const result = await ingestOdds(await client.getPaged("/odds", { fixture: target.providerId }));
    captured += result.quotes;
    rejected += result.rejected;
  }
  const remaining = missingOddsCoverageTargets(targets, await loadQuotes(targets.map((target) => target.fixtureId))).length;
  return { forecasts: forecast.predicted, checked: targets.length, retried: missing.length, captured, rejected, remaining };
}
