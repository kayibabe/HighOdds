import { db } from "@highodds/db";
import {
  blantyreDayBounds, calibrationBuckets, calibrationByMarket, calibrationBySelection, displayLegOutcome, filterPicks, median, modelPicks,
  parseSettlementEvidence, QUOTE_MAX_AGE_MINUTES, resolveSelection, SELECTION_WINDOW_HOURS, summarizeLegs, summarizePicks, summarizeTiers, utcDate,
  type DayRange, type LegSummaryInput, type PickFilter, type ScoredPrediction, type TicketOutcome
} from "@highodds/core";
import { averageClv } from "./clv";
import { decisionLegs } from "./tickets";

// Loaders for the /analysis page. Each returns plain numbers; the aggregation maths lives in
// @highodds/core (analysis.ts) where it is unit-tested.

const HOUR_MS = 60 * 60 * 1000;
/** A scheduled fixture this long past kickoff should have a result by now. */
const OVERDUE_RESULT_HOURS = 3;
/** Job health looks at this many recent days of runs. */
const JOB_HISTORY_DAYS = 14;
/** A competition's latest model older than this is flagged stale (TRAIN_MODEL runs daily). */
export const MODEL_STALE_HOURS = 48;

// "All time" still needs concrete bounds for a parameterised query.
const EPOCH = new Date(0);
const FAR_FUTURE = new Date("9999-12-31T00:00:00.000Z");

function kickoffBounds(range: DayRange): { start: Date; end: Date } {
  if (!range.from || !range.to) return { start: EPOCH, end: FAR_FUTURE };
  return { start: blantyreDayBounds(range.from).start, end: blantyreDayBounds(range.to).end };
}

function targetDateWhere(range: DayRange) {
  if (!range.from || !range.to) return {};
  return { targetDate: { gte: utcDate(range.from), lte: utcDate(range.to) } };
}

export interface JobHealth {
  jobType: string;
  latestStatus: string;
  latestRunAfter: Date;
  latestAttempts: number;
  lastError: string | null;
  lastCompletedAt: Date | null;
  runs: number;
  done: number;
}

export async function loadPipelineHealth(now: Date) {
  const since = new Date(now.getTime() - JOB_HISTORY_DAYS * 24 * HOUR_MS);
  const [jobs, quota, fixtureStatus, competitions, teams, bookmakers, activeBookmakers, markets, normalizedMarkets, quotes, predictions, modelRuns,
    lastFixture, lastQuote, lastPrediction, lastModelRun, lastTicket, lastSettlement, overdueResults, unsettledLocked] = await Promise.all([
    db.jobRun.findMany({ where: { runAfter: { gte: since } }, orderBy: { runAfter: "desc" } }),
    db.apiQuotaUsage.findMany({ orderBy: { usageDate: "desc" }, take: 7 }),
    db.fixture.groupBy({ by: ["status"], _count: { _all: true } }),
    db.competition.count(),
    db.team.count(),
    db.bookmaker.count(),
    db.bookmaker.count({ where: { active: true } }),
    db.market.count(),
    db.market.count({ where: { normalizedKey: { not: null } } }),
    db.oddsQuote.count(),
    db.prediction.count(),
    db.modelRun.count(),
    db.fixture.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    db.oddsQuote.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
    db.prediction.findFirst({ orderBy: { asOfAt: "desc" }, select: { asOfAt: true } }),
    db.modelRun.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.ticketVersion.findFirst({ orderBy: { publishedAt: "desc" }, select: { publishedAt: true } }),
    db.settlement.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.fixture.count({ where: { status: { in: ["SCHEDULED", "LIVE"] }, kickoff: { lt: new Date(now.getTime() - OVERDUE_RESULT_HOURS * HOUR_MS) } } }),
    db.ticketVersion.count({ where: { successors: { none: {} }, lockAt: { lte: now }, settlements: { none: {} } } })
  ]);

  const byType = new Map<string, typeof jobs>();
  for (const job of jobs) byType.set(job.jobType, [...(byType.get(job.jobType) ?? []), job]);
  const jobHealth: JobHealth[] = [...byType.entries()].map(([jobType, runs]) => {
    const latest = runs[0]!;
    const completed = runs.filter((run) => run.completedAt).map((run) => run.completedAt!.getTime());
    return {
      jobType, latestStatus: latest.status, latestRunAfter: latest.runAfter, latestAttempts: latest.attempts, lastError: latest.lastError,
      lastCompletedAt: completed.length ? new Date(Math.max(...completed)) : null,
      runs: runs.length, done: runs.filter((run) => run.status === "DONE").length
    };
  }).sort((a, b) => a.jobType.localeCompare(b.jobType));

  return {
    jobHealth, jobHistoryDays: JOB_HISTORY_DAYS, quota,
    fixturesByStatus: Object.fromEntries(fixtureStatus.map((row) => [row.status, row._count._all])) as Record<string, number>,
    inventory: { competitions, teams, bookmakers, activeBookmakers, markets, normalizedMarkets, quotes, predictions, modelRuns },
    freshness: [
      { label: "Fixture update received", at: lastFixture?.receivedAt ?? null },
      { label: "Odds quote captured", at: lastQuote?.capturedAt ?? null },
      { label: "Model trained", at: lastModelRun?.createdAt ?? null },
      { label: "Prediction recorded", at: lastPrediction?.asOfAt ?? null },
      { label: "Ticket published", at: lastTicket?.publishedAt ?? null },
      { label: "Ticket settled", at: lastSettlement?.createdAt ?? null }
    ],
    overdueResults, overdueResultHours: OVERDUE_RESULT_HOURS, unsettledLocked
  };
}

/** How the next selection window's fixtures thin out through each gate the publisher applies. */
export async function loadUpcomingFunnel(now: Date) {
  const windowEnd = new Date(now.getTime() + SELECTION_WINDOW_HOURS * HOUR_MS);
  const fixtures = await db.fixture.findMany({
    where: { status: "SCHEDULED", kickoff: { gte: now, lte: windowEnd } },
    select: { id: true, competitionId: true, kickoff: true }
  });
  const ids = fixtures.map((fixture) => fixture.id);
  const competitionIds = [...new Set(fixtures.map((fixture) => fixture.competitionId))];
  const freshSince = new Date(now.getTime() - QUOTE_MAX_AGE_MINUTES * 60 * 1000);
  const [modelled, predicted, priced, freshPriced, ticketed] = ids.length === 0 ? [[], [], [], [], []] : await Promise.all([
    db.modelRun.findMany({ where: { competitionId: { in: competitionIds } }, distinct: ["competitionId"], select: { competitionId: true } }),
    db.prediction.findMany({ where: { fixtureId: { in: ids } }, distinct: ["fixtureId"], select: { fixtureId: true } }),
    db.oddsQuote.findMany({ where: { fixtureId: { in: ids }, bookmaker: { active: true }, market: { normalizedKey: { not: null } } }, distinct: ["fixtureId"], select: { fixtureId: true } }),
    db.oddsQuote.findMany({ where: { fixtureId: { in: ids }, capturedAt: { gte: freshSince }, bookmaker: { active: true }, market: { normalizedKey: { not: null } } }, distinct: ["fixtureId"], select: { fixtureId: true } }),
    db.ticketLeg.findMany({ where: { fixtureId: { in: ids }, ticketVersion: { successors: { none: {} } } }, distinct: ["fixtureId"], select: { fixtureId: true } })
  ]);
  const modelledCompetitions = new Set(modelled.map((row) => row.competitionId));
  const predictedIds = new Set(predicted.map((row) => row.fixtureId));
  const freshIds = new Set(freshPriced.map((row) => row.fixtureId));
  return {
    windowHours: SELECTION_WINDOW_HOURS, quoteMaxAgeMinutes: QUOTE_MAX_AGE_MINUTES,
    steps: [
      { label: "Scheduled in the window", count: fixtures.length, note: `Kick off within ${SELECTION_WINDOW_HOURS}h` },
      { label: "Competition has a trained model", count: fixtures.filter((fixture) => modelledCompetitions.has(fixture.competitionId)).length, note: "Any ModelRun for the competition" },
      { label: "Model prediction stored", count: predictedIds.size, note: "Passed the league and team evidence floors" },
      { label: "Priced by an active bookmaker", count: priced.length, note: "Any captured quote in a supported market" },
      { label: "Price fresh right now", count: freshIds.size, note: `Captured within the last ${QUOTE_MAX_AGE_MINUTES} min` },
      { label: "Predicted and freshly priced", count: [...predictedIds].filter((id) => freshIds.has(id)).length, note: "Could become a candidate leg on a run now" },
      { label: "On a current ticket", count: ticketed.length, note: "Leg of a non-superseded ticket version" }
    ]
  };
}

type ModelRow = { competitionId: string; name: string; country: string | null; method: string; trainedUntil: Date; homeAdvantage: number | null; leagueAverageGoals: number | null; teams: number; matches: number };

/** The latest fitted parameters for every modelled competition. */
export async function loadModelCoverage(now: Date) {
  const rows = await db.$queryRaw<ModelRow[]>`
    SELECT DISTINCT ON (mr."competitionId")
      mr."competitionId", c."name", c."country", mr."method", mr."trainedUntil",
      (mr."artifact"->>'homeAdvantage')::float8 AS "homeAdvantage",
      (mr."artifact"->>'leagueAverageGoals')::float8 AS "leagueAverageGoals",
      (SELECT count(*) FROM jsonb_object_keys(COALESCE(mr."artifact"->'teams', '{}'::jsonb)))::int AS "teams",
      (SELECT COALESCE(sum((t.value->>'matchCount')::int), 0) FROM jsonb_each(COALESCE(mr."artifact"->'teams', '{}'::jsonb)) t)::int / 2 AS "matches"
    FROM "ModelRun" mr JOIN "Competition" c ON c."id" = mr."competitionId"
    WHERE mr."competitionId" IS NOT NULL
    ORDER BY mr."competitionId", mr."createdAt" DESC`;
  const staleBefore = now.getTime() - MODEL_STALE_HOURS * HOUR_MS;
  const homeAdvantages = rows.flatMap((row) => row.homeAdvantage === null ? [] : [row.homeAdvantage]);
  const goalAverages = rows.flatMap((row) => row.leagueAverageGoals === null ? [] : [row.leagueAverageGoals]);
  const trainedTimes = rows.map((row) => row.trainedUntil.getTime());
  return {
    competitions: rows.length,
    stale: rows.filter((row) => row.trainedUntil.getTime() < staleBefore).length,
    medianHomeAdvantage: median(homeAdvantages),
    minHomeAdvantage: homeAdvantages.length ? Math.min(...homeAdvantages) : null,
    maxHomeAdvantage: homeAdvantages.length ? Math.max(...homeAdvantages) : null,
    medianLeagueAverageGoals: median(goalAverages),
    medianTeams: median(rows.map((row) => row.teams)),
    medianMatches: median(rows.map((row) => row.matches)),
    newestTrainedUntil: trainedTimes.length ? new Date(Math.max(...trainedTimes)) : null,
    oldestTrainedUntil: trainedTimes.length ? new Date(Math.min(...trainedTimes)) : null,
    methods: [...new Set(rows.map((row) => row.method))],
    largest: [...rows].sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name)).slice(0, 25),
    staleBeforeHours: MODEL_STALE_HOURS
  };
}

type PredictionRow = { fixtureId: string; marketKey: string; selection: string; probability: number; asOfAt: Date; kickoff: Date; trainedUntil: Date; homeGoals: number; awayGoals: number };

/**
 * Walk-forward scoring with the same rules as the Results page: the latest prediction per fixture,
 * market and selection, kept only when it was made before kickoff by a model trained no later.
 */
export async function loadCalibration(range: DayRange) {
  const { start, end } = kickoffBounds(range);
  const rows = await db.$queryRaw<PredictionRow[]>`
    SELECT DISTINCT ON (p."fixtureId", p."marketId", p."selection")
      p."fixtureId", m."normalizedKey" AS "marketKey", p."selection", p."probability"::float8 AS "probability",
      p."asOfAt", f."kickoff", mr."trainedUntil", f."homeGoals", f."awayGoals"
    FROM "Prediction" p
      JOIN "Fixture" f ON f."id" = p."fixtureId"
      JOIN "Market" m ON m."id" = p."marketId"
      JOIN "ModelRun" mr ON mr."id" = p."modelRunId"
    WHERE f."status" = 'FINISHED' AND f."homeGoals" IS NOT NULL AND f."awayGoals" IS NOT NULL AND m."normalizedKey" IS NOT NULL
      AND f."kickoff" >= ${start} AND f."kickoff" < ${end}
    ORDER BY p."fixtureId", p."marketId", p."selection", p."asOfAt" DESC`;
  const scored: ScoredPrediction[] = [];
  let excluded = 0;
  for (const row of rows) {
    const result = resolveSelection(row.marketKey, row.selection, row.homeGoals, row.awayGoals);
    if (result === null || row.asOfAt >= row.kickoff || row.trainedUntil > row.asOfAt) { excluded += 1; continue; }
    scored.push({ fixtureId: row.fixtureId, marketKey: row.marketKey, selection: row.selection, probability: row.probability, hit: result === "WIN" });
  }
  return {
    scored: scored.length, excluded, rows: scored,
    byMarket: calibrationByMarket(scored),
    bySelection: calibrationBySelection(scored),
    buckets: calibrationBuckets(scored)
  };
}

type ClosingPriceRow = { fixtureId: string; marketKey: string; selection: string; odds: number };

/**
 * Hit rate and flat-stake ROI of every model pick (the highest-probability selection per fixture and
 * market) among the walk-forward forecasts scored by loadCalibration. Each pick is priced at the last
 * pre-kickoff quote from the highest-priority active bookmaker that quoted it, the book a ticket would try first.
 */
export async function loadModelPicks(range: DayRange, scored: ScoredPrediction[], filter: PickFilter) {
  if (scored.length === 0) return { total: 0, overall: null, groups: [], picks: 0, ...summarizePicks([]) };
  const { start, end } = kickoffBounds(range);
  const prices = await db.$queryRaw<ClosingPriceRow[]>`
    SELECT DISTINCT ON (q."fixtureId", q."marketId", q."selection")
      q."fixtureId", m."normalizedKey" AS "marketKey", q."selection", q."decimalOdds"::float8 AS "odds"
    FROM "OddsQuote" q
      JOIN "Fixture" f ON f."id" = q."fixtureId"
      JOIN "Market" m ON m."id" = q."marketId"
      JOIN "Bookmaker" b ON b."id" = q."bookmakerId"
    WHERE f."status" = 'FINISHED' AND f."kickoff" >= ${start} AND f."kickoff" < ${end}
      AND q."capturedAt" < f."kickoff" AND b."active" = true AND m."normalizedKey" IS NOT NULL
    ORDER BY q."fixtureId", q."marketId", q."selection", b."priority", b."id", q."capturedAt" DESC`;
  const priceByKey = new Map(prices.map((row) => [`${row.fixtureId}:${row.marketKey}:${row.selection}`, row.odds]));
  const all = modelPicks(scored, (row) => priceByKey.get(`${row.fixtureId}:${row.marketKey}:${row.selection}`) ?? null);
  const unfiltered = summarizePicks(all);
  const picks = filterPicks(all, filter);
  return {
    // Unfiltered totals feed the headline tile and the filter's options, so they stay stable while filtering.
    total: all.length, overall: unfiltered.byMarket.find((row) => row.group === "ALL") ?? null,
    groups: unfiltered.bySelection.map((row) => row.group),
    picks: picks.length, ...(picks.length === all.length ? unfiltered : summarizePicks(picks))
  };
}

export interface DailyModelPick {
  fixtureId: string;
  kickoff: Date;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  marketKey: string;
  selection: string;
  probability: number;
  outcome: "WIN" | "LOSS";
  onTicket: boolean;
}

/**
 * The finished, walk-forward model picks for one dashboard day. This deliberately uses the same
 * pre-kickoff and model-trained-before-forecast gates as the analysis page, then keeps the highest
 * probability selection per fixture and market, matching the Model picks definition.
 */
export async function loadDailyModelPicks(day: string): Promise<DailyModelPick[]> {
  const { start, end } = { start: blantyreDayBounds(day).start, end: blantyreDayBounds(day).end };
  const rows = await db.$queryRaw<Array<{
    fixtureId: string; kickoff: Date; homeTeam: string; awayTeam: string; competition: string;
    marketKey: string; selection: string; probability: number; outcome: "WIN" | "LOSS";
  }>>`
    SELECT p."fixtureId", f."kickoff", ht."name" AS "homeTeam", at."name" AS "awayTeam", c."name" AS "competition",
      m."normalizedKey" AS "marketKey", p."selection", p."probability"::float8 AS "probability",
      CASE
        WHEN m."normalizedKey" = 'MATCH_WINNER' AND p."selection" = CASE WHEN f."homeGoals" > f."awayGoals" THEN 'HOME' WHEN f."homeGoals" < f."awayGoals" THEN 'AWAY' ELSE 'DRAW' END THEN 'WIN'
        WHEN m."normalizedKey" = 'TOTAL_GOALS' AND p."selection" = CASE WHEN f."homeGoals" + f."awayGoals" >= 3 THEN 'OVER_2_5' ELSE 'UNDER_2_5' END THEN 'WIN'
        WHEN m."normalizedKey" = 'BTTS' AND p."selection" = CASE WHEN f."homeGoals" > 0 AND f."awayGoals" > 0 THEN 'YES' ELSE 'NO' END THEN 'WIN'
        ELSE 'LOSS'
      END AS "outcome"
    FROM "Prediction" p
      JOIN "Fixture" f ON f."id" = p."fixtureId"
      JOIN "Market" m ON m."id" = p."marketId"
      JOIN "ModelRun" mr ON mr."id" = p."modelRunId"
      JOIN "Team" ht ON ht."id" = f."homeTeamId"
      JOIN "Team" at ON at."id" = f."awayTeamId"
      JOIN "Competition" c ON c."id" = f."competitionId"
    WHERE f."status" = 'FINISHED' AND f."homeGoals" IS NOT NULL AND f."awayGoals" IS NOT NULL
      AND m."normalizedKey" IS NOT NULL AND f."kickoff" >= ${start} AND f."kickoff" < ${end}
      AND p."asOfAt" < f."kickoff" AND mr."trainedUntil" <= p."asOfAt"
    ORDER BY p."fixtureId", p."marketId", p."selection", p."asOfAt" DESC`;
  const best = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.fixtureId}:${row.marketKey}`;
    const current = best.get(key);
    if (!current || row.probability > current.probability) best.set(key, row);
  }
  const picks = [...best.values()];
  if (picks.length === 0) return [];
  const ticketLegs = await db.ticketLeg.findMany({
    where: { fixtureId: { in: [...new Set(picks.map((pick) => pick.fixtureId))] }, ticketVersion: { successors: { none: {} } } },
    select: { fixtureId: true, marketKey: true, selection: true }
  });
  const ticketKeys = new Set(ticketLegs.map((leg) => `${leg.fixtureId}:${leg.marketKey}:${leg.selection}`));
  return picks
    .sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime() || a.homeTeam.localeCompare(b.homeTeam) || a.marketKey.localeCompare(b.marketKey))
    .map((pick) => ({ ...pick, probability: Number(pick.probability), onTicket: ticketKeys.has(`${pick.fixtureId}:${pick.marketKey}:${pick.selection}`) }));
}

/** Tier and market performance for current (non-superseded) ticket versions in the range. */
export async function loadTicketPerformance(range: DayRange) {
  const tickets = await db.ticketVersion.findMany({
    where: { ...targetDateWhere(range), successors: { none: {} } },
    include: { legs: { include: { fixture: { select: { status: true, homeGoals: true, awayGoals: true } } } }, settlements: true }
  });
  const legs: LegSummaryInput[] = [];
  const thresholds = new Map<number, number>();
  const tierInputs = tickets.map((ticket) => {
    const settlement = ticket.settlements[0];
    const outcome: TicketOutcome = settlement?.outcome ?? "PENDING";
    const evidence = new Map(parseSettlementEvidence(outcome === "PENDING" ? null : settlement?.evidence).map((row) => [row.fixtureId, row]));
    const decisions = decisionLegs(ticket.decision);
    for (const leg of ticket.legs) {
      const recorded = evidence.get(leg.fixtureId);
      const snapshot = decisions.find((item) => item.fixtureId === leg.fixtureId && item.market === leg.marketKey && item.selection === leg.selection);
      legs.push({
        marketKey: leg.marketKey, decimalOdds: Number(leg.decimalOdds), probability: Number(leg.probability),
        outcome: displayLegOutcome(recorded, leg.marketKey, leg.selection, leg.fixture).outcome,
        confidenceScore: snapshot?.confidenceScore ?? null
      });
    }
    thresholds.set(ticket.confidenceThreshold, (thresholds.get(ticket.confidenceThreshold) ?? 0) + 1);
    return {
      tier: ticket.tier, outcome, combinedOdds: Number(ticket.combinedOdds), relaxed: ticket.relaxed,
      profitUnits: settlement?.profitUnits === null || settlement?.profitUnits === undefined ? null : Number(settlement.profitUnits),
      legProbabilities: ticket.legs.map((leg) => Number(leg.probability))
    };
  });
  const settledIds = tickets.filter((ticket) => ticket.settlements[0] && ticket.settlements[0].outcome !== "PENDING").map((ticket) => ticket.id);
  return {
    tickets: tickets.length,
    tiers: summarizeTiers(tierInputs),
    markets: summarizeLegs(legs),
    thresholds: [...thresholds.entries()].sort((a, b) => b[0] - a[0]).map(([threshold, count]) => ({ threshold, count })),
    clv: await averageClv(settledIds)
  };
}
