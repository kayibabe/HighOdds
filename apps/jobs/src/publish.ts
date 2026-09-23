import { db } from "@highodds/db";
import { buildTicketsAround, conservativeExpectedValue, devigProbability, quoteIsFresh, type CandidateLeg, type SupportedMarket, type TicketTier } from "@highodds/core";
import { generatePredictions } from "./predict.js";

const SELECTION_WINDOW_MS = 20 * 60 * 60 * 1000;

const MARKET_OUTCOME_COUNT: Record<SupportedMarket, number> = { MATCH_WINNER: 3, TOTAL_GOALS: 2, BTTS: 2 };

export interface PublishResult { published: number; predicted: number; predictionsSkipped: number; }

export async function publishTickets(now: Date): Promise<PublishResult> {
  const forecast = await generatePredictions(now);
  const result = (published: number): PublishResult => ({ published, predicted: forecast.predicted, predictionsSkipped: forecast.skipped });
  const windowEnd = new Date(now.getTime() + SELECTION_WINDOW_MS);
  const fixtures = await db.fixture.findMany({
    where: { status: "SCHEDULED", kickoff: { gte: now, lte: windowEnd } },
    select: { id: true, competitionId: true, kickoff: true }
  });
  if (fixtures.length === 0) return result(0);
  const fixtureIds = fixtures.map((fixture) => fixture.id);
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

  const activeBookmakers = await db.bookmaker.findMany({ where: { active: true }, orderBy: { priority: "asc" } });
  if (activeBookmakers.length === 0) return result(0);
  const bookmakerPriority = activeBookmakers.map((bookmaker) => bookmaker.id);

  const markets = await db.market.findMany({ where: { normalizedKey: { not: null } }, select: { id: true, normalizedKey: true } });
  const marketKeyById = new Map(markets.map((market) => [market.id, market.normalizedKey as SupportedMarket]));

  const quotes = await db.oddsQuote.findMany({
    where: { fixtureId: { in: fixtureIds }, marketId: { in: markets.map((m) => m.id) }, bookmakerId: { in: bookmakerPriority } },
    orderBy: { capturedAt: "desc" },
    distinct: ["fixtureId", "bookmakerId", "marketId", "selection"]
  });
  const freshQuotes = quotes.filter((quote) => {
    const fixture = fixtureById.get(quote.fixtureId);
    return fixture ? quoteIsFresh({ capturedAt: quote.capturedAt }, fixture.kickoff, now) : false;
  });
  if (freshQuotes.length === 0) return result(0);

  const predictions = await db.prediction.findMany({
    where: { fixtureId: { in: fixtureIds }, marketId: { in: markets.map((m) => m.id) } },
    orderBy: { asOfAt: "desc" },
    distinct: ["fixtureId", "marketId", "selection"]
  });
  const predictionKey = (fixtureId: string, marketId: string, selection: string) => `${fixtureId}:${marketId}:${selection}`;
  const predictionByKey = new Map(predictions.map((prediction) => [predictionKey(prediction.fixtureId, prediction.marketId, prediction.selection), prediction]));

  // Devig consensus probability per (fixture, market, selection) averaged across bookmakers offering that market.
  const byFixtureBookmakerMarket = new Map<string, typeof freshQuotes>();
  for (const quote of freshQuotes) {
    const groupKey = `${quote.fixtureId}:${quote.bookmakerId}:${quote.marketId}`;
    const group = byFixtureBookmakerMarket.get(groupKey) ?? [];
    group.push(quote);
    byFixtureBookmakerMarket.set(groupKey, group);
  }
  const consensusSum = new Map<string, { sum: number; count: number }>();
  for (const group of byFixtureBookmakerMarket.values()) {
    const marketKey = marketKeyById.get(group[0]!.marketId);
    if (!marketKey) continue;
    const uniqueSelections = new Set(group.map((quote) => quote.selection));
    if (uniqueSelections.size < MARKET_OUTCOME_COUNT[marketKey]) continue; // partial market: devigging would misprice the missing outcome as impossible
    const allOdds = group.map((quote) => Number(quote.decimalOdds));
    for (const quote of group) {
      const devigged = devigProbability(Number(quote.decimalOdds), allOdds);
      const key = predictionKey(quote.fixtureId, quote.marketId, quote.selection);
      const running = consensusSum.get(key) ?? { sum: 0, count: 0 };
      running.sum += devigged; running.count += 1;
      consensusSum.set(key, running);
    }
  }

  const candidates: CandidateLeg[] = [];
  for (const quote of freshQuotes) {
    const marketKey = marketKeyById.get(quote.marketId);
    if (!marketKey) continue;
    const fixture = fixtureById.get(quote.fixtureId);
    if (!fixture) continue;
    const key = predictionKey(quote.fixtureId, quote.marketId, quote.selection);
    const prediction = predictionByKey.get(key);
    const consensus = consensusSum.get(key);
    if (!prediction || !consensus) continue;
    const modelProbability = Number(prediction.probability);
    const consensusProbability = consensus.sum / consensus.count;
    const decimalOdds = Number(quote.decimalOdds);
    const agreement = Math.min(modelProbability, consensusProbability) / Math.max(modelProbability, consensusProbability);
    candidates.push({
      bookmakerId: quote.bookmakerId, fixtureId: quote.fixtureId, market: marketKey, selection: quote.selection,
      decimalOdds, capturedAt: quote.capturedAt, modelProbability, consensusProbability,
      conservativeExpectedValue: conservativeExpectedValue(modelProbability, decimalOdds), confidenceScore: Math.round(agreement * 100),
      leagueId: fixture.competitionId, kickoff: fixture.kickoff
    });
  }
  if (candidates.length === 0) return result(0);

  const targetDate = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const liveVersions = await db.ticketVersion.findMany({
    where: { targetDate, successors: { none: {} } },
    orderBy: { publishedAt: "desc" },
    include: { legs: { select: { fixtureId: true } } }
  });
  const openByTier = new Map<TicketTier["key"], (typeof liveVersions)[number]>();
  for (const version of liveVersions) if (!openByTier.has(version.tier)) openByTier.set(version.tier, version);

  // Tiers never share a fixture, including with today's tickets that stay live (locked, or not replaced).
  const drafts = buildTicketsAround(candidates, bookmakerPriority, now, [...openByTier.values()].map((version) => ({
    tier: version.tier, locked: version.lockAt <= now, fixtureIds: version.legs.map((leg) => leg.fixtureId)
  })));
  let published = 0;

  for (const draft of drafts) {
    const open = openByTier.get(draft.tier.key);
    if (open && open.lockAt <= now) continue; // defensive: buildTicketsAround never drafts a locked tier
    const lockAt = draft.legs.reduce((earliest, leg) => (leg.kickoff < earliest ? leg.kickoff : earliest), draft.legs[0]!.kickoff);
    await db.$transaction(async (tx) => {
      const version = await tx.ticketVersion.create({
        data: {
          targetDate, tier: draft.tier.key, bookmakerId: draft.bookmakerId, combinedOdds: draft.combinedOdds,
          confidenceThreshold: draft.confidenceThreshold, relaxed: draft.relaxed, lockAt,
          supersedesId: open?.id ?? null,
          decision: draft.legs.map((leg) => ({ fixtureId: leg.fixtureId, market: leg.market, selection: leg.selection, decimalOdds: leg.decimalOdds, modelProbability: leg.modelProbability, consensusProbability: leg.consensusProbability, confidenceScore: leg.confidenceScore })) as unknown as object
        }
      });
      for (const leg of draft.legs) {
        const quote = freshQuotes.find((q) => q.fixtureId === leg.fixtureId && q.bookmakerId === leg.bookmakerId && q.selection === leg.selection && marketKeyById.get(q.marketId) === leg.market);
        if (!quote) throw new Error(`Missing source quote for leg ${leg.fixtureId}/${leg.selection}`);
        await tx.ticketLeg.create({ data: { ticketVersionId: version.id, fixtureId: leg.fixtureId, quoteId: quote.id, marketKey: leg.market, selection: leg.selection, decimalOdds: leg.decimalOdds, probability: leg.modelProbability } });
      }
    });
    published += 1;
  }
  return result(published);
}
