import { db } from "@highodds/db";
import {
  blantyreDayBounds, calibrationBuckets, calibrationByMarket, calibrationBySelection, evidenceLegOutcome, legOutcome, median,
  parseSettlementEvidence, QUOTE_MAX_AGE_MINUTES, resolveSelection, SELECTION_WINDOW_HOURS, summarizeLegs, summarizeTiers, utcDate,
  type DayRange, type LegSummaryInput, type ScoredPrediction, type TicketOutcome
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
    scored: scored.length, excluded,
    byMarket: calibrationByMarket(scored),
    bySelection: calibrationBySelection(scored),
    buckets: calibrationBuckets(scored)
  };
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
        outcome: recorded ? evidenceLegOutcome(recorded) : legOutcome(leg.marketKey, leg.selection, leg.fixture),
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
