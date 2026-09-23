import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@highodds/db";
import { dixonColesDistribution, expectedGoals, type TeamStrengths } from "@highodds/core";
import { generatePredictions } from "../src/predict.js";
import { publishTickets } from "../src/publish.js";
import { refreshPendingResults, settleResults } from "../src/settle.js";

/**
 * Exercises publishTickets/settleResults end to end against a real local Postgres, the same way
 * ingestion.integration.test.ts exercises ingestFixtures/ingestOdds. See that file for the general
 * synthetic-ID/`_test`-database safety rationale; the same constraints apply here.
 *
 * TicketVersion/TicketLeg rows are append-only at the database level (see the
 * highodds_ticket_version_no_update/highodds_ticket_leg_no_update triggers in
 * packages/db/prisma/migrations/20260920100000_init/migration.sql) and TicketLeg.fixtureId is a
 * real, non-nullable foreign key to Fixture with the default RESTRICT behavior. Once a test here
 * publishes a ticket, its Fixture/Competition/Team rows can never be deleted again -- by design,
 * matching production. afterAll only cleans up the rows that are actually mutable (Prediction,
 * ModelRun, OddsQuote, Market, Bookmaker); the fixture/competition/team graph is intentionally left
 * behind, exactly like a real settled ticket would be.
 */
const databaseUrl = process.env.DATABASE_URL;
const isTestDatabase = !!databaseUrl && /\/[^/?]*_test(\?|$)/.test(databaseUrl);

describe.skipIf(!databaseUrl)("publishTickets and settleResults (live DB)", () => {
  beforeAll(() => {
    if (!isTestDatabase) {
      throw new Error(
        `Refusing to run publish-settle.integration.test.ts against DATABASE_URL="${databaseUrl}": its database ` +
        `name must end with "_test" (e.g. highodds_test). This suite writes ticket/settlement rows that can never ` +
        `be deleted and must never run against a database that could hold real data.`
      );
    }
  });

  describe("full pipeline: train -> predict -> publish -> settle a winner", () => {
    const RUN_SEED = randomInt(1, 90_000);
    const BASE = 700_000_000 + RUN_SEED * 1000;
    const POOL_SIZE = 10;
    const HISTORY_TARGET = 50;

    // TicketVersion rows are permanent (append-only), and publishTickets' "open ticket for this
    // targetDate/tier" check isn't scoped to a single bookmaker -- so a fixed date would collide
    // with the previous run's ticket on every re-run. Spreading `now` over ~8 years of RUN_SEED
    // keeps every run's targetDate effectively unique.
    const now = new Date(Date.UTC(2026, 1, 1, 8, 0, 0) + RUN_SEED * 24 * 60 * 60 * 1000);
    const kickoff1 = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const kickoff2 = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const capturedAt = new Date(now.getTime() - 30 * 60 * 1000);

    let competitionId: string;
    let poolTeamIds: string[];
    let fixture1Id: string;
    let fixture2Id: string;
    let bookmakerId: string;
    let modelRunId: string;
    let marketWinnerId: string;
    let ticketVersionId: string;
    let expectedCombinedOdds: number;

    beforeAll(async () => {
      const competition = await db.competition.create({ data: { providerId: BASE + 1, name: "Synthetic Test League", country: null } });
      competitionId = competition.id;

      const pool = [];
      for (let i = 0; i < POOL_SIZE; i += 1) {
        pool.push(await db.team.create({ data: { providerId: BASE + 10 + i, name: `Synthetic Team ${i}` } }));
      }
      poolTeamIds = pool.map((team) => team.id);

      // Single round-robin (45 pairs) + 5 repeats = 50 FINISHED fixtures, so every pool team has
      // 9+ appearances (>= leagueEligibility's 8-per-team floor) and the competition clears the
      // 50-match floor. Scorelines are arbitrary: this suite hand-crafts the ModelRun artifact
      // below instead of fitting one, so only the *match count* (not the goals) feeds eligibility.
      const pairs: Array<[number, number]> = [];
      for (let i = 0; i < POOL_SIZE; i += 1) for (let j = i + 1; j < POOL_SIZE; j += 1) pairs.push([i, j]);
      while (pairs.length < HISTORY_TARGET) pairs.push(pairs[pairs.length - 45]!);

      let providerId = BASE + 100;
      let daysAgo = HISTORY_TARGET;
      for (const [i, j] of pairs) {
        await db.fixture.create({
          data: {
            providerId: providerId++, competitionId,
            homeTeamId: poolTeamIds[i]!, awayTeamId: poolTeamIds[j]!,
            kickoff: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000),
            status: "FINISHED", homeGoals: 1, awayGoals: 0
          }
        });
        daysAgo -= 1;
      }

      const fixture1 = await db.fixture.create({ data: { providerId: BASE + 200, competitionId, homeTeamId: poolTeamIds[0]!, awayTeamId: poolTeamIds[1]!, kickoff: kickoff1, status: "SCHEDULED" } });
      const fixture2 = await db.fixture.create({ data: { providerId: BASE + 201, competitionId, homeTeamId: poolTeamIds[2]!, awayTeamId: poolTeamIds[3]!, kickoff: kickoff2, status: "SCHEDULED" } });
      fixture1Id = fixture1.id; fixture2Id = fixture2.id;

      const bookmaker = await db.bookmaker.create({ data: { providerId: BASE + 300, name: "Synthetic Bookmaker", priority: 1, active: true } });
      bookmakerId = bookmaker.id;

      // generatePredictions only creates predictions for markets it can see, so this suite needs
      // its own MATCH_WINNER-normalized Market row -- it can't assume another test happened to
      // leave one behind.
      const market = await db.market.create({ data: { providerId: BASE + 310, name: "Match Winner", normalizedKey: "MATCH_WINNER", selectionEnabled: true } });
      marketWinnerId = market.id;

      // Every team gets identical attack/defense: both scenario fixtures then have exactly the
      // same, precisely known homeWin/draw/awayWin distribution, computed below with the real
      // core functions instead of a copy-pasted magic number.
      const strengths: TeamStrengths = {
        homeAdvantage: 1.3,
        leagueAverageGoals: 1.4,
        teams: Object.fromEntries(poolTeamIds.map((id) => [id, { attack: 1, defense: 1, matchCount: HISTORY_TARGET }]))
      };
      const modelRun = await db.modelRun.create({ data: { competitionId, version: "test", method: "dixon-coles-ipf-v1", trainedUntil: now, artifact: strengths as unknown as object } });
      modelRunId = modelRun.id;

      const goals = expectedGoals(poolTeamIds[0]!, poolTeamIds[1]!, strengths);
      const dist = dixonColesDistribution(goals.home, goals.away);

      await generatePredictions(now);

      const [homePrediction, drawPrediction, awayPrediction] = await Promise.all([
        db.prediction.findFirstOrThrow({ where: { fixtureId: fixture1Id, modelRunId, selection: "HOME" } }),
        db.prediction.findFirstOrThrow({ where: { fixtureId: fixture1Id, modelRunId, selection: "DRAW" } }),
        db.prediction.findFirstOrThrow({ where: { fixtureId: fixture1Id, modelRunId, selection: "AWAY" } })
      ]);
      marketWinnerId = homePrediction.marketId;
      expect(homePrediction.marketId).toBe(drawPrediction.marketId);
      expect(homePrediction.marketId).toBe(awayPrediction.marketId);
      expect(Number(homePrediction.probability)).toBeCloseTo(dist.homeWin, 6);

      // Priced 30% above the model's own fair price on HOME (a legitimate "the market is wrong"
      // scenario) but fair on DRAW/AWAY, so conservativeExpectedValue(HOME) is a positive constant
      // (0.98 * 1.3 - 1) independent of the exact probability, while consensus still lands close
      // enough to the model to clear the >=70 confidence gate.
      const HOME_GENEROSITY = 1.3;
      const homeOdds = HOME_GENEROSITY / dist.homeWin;
      const drawOdds = 1 / dist.draw;
      const awayOdds = 1 / dist.awayWin;
      expectedCombinedOdds = homeOdds * homeOdds; // both scenario fixtures share the same strengths/odds

      for (const fixtureId of [fixture1Id, fixture2Id]) {
        for (const [selection, decimalOdds] of [["HOME", homeOdds], ["DRAW", drawOdds], ["AWAY", awayOdds]] as const) {
          await db.oddsQuote.create({ data: { fixtureId, bookmakerId, marketId: marketWinnerId, selection, decimalOdds, capturedAt } });
        }
      }
    });

    afterAll(async () => {
      await db.prediction.deleteMany({ where: { fixtureId: { in: [fixture1Id, fixture2Id] } } });
      await db.modelRun.deleteMany({ where: { id: modelRunId } });
      await db.oddsQuote.deleteMany({ where: { fixtureId: { in: [fixture1Id, fixture2Id] } } });
      await db.market.deleteMany({ where: { id: marketWinnerId } });
      await db.bookmaker.deleteMany({ where: { id: bookmakerId } });
    });

    it("publishes a STANDARD-tier ticket from a positive-EV mispriced quote", async () => {
      const result = await publishTickets(now);
      expect(result.published).toBeGreaterThanOrEqual(1);
      expect(result.predicted).toBeGreaterThanOrEqual(0);
      expect(result.predictionsSkipped).toBeGreaterThanOrEqual(0);

      const versions = await db.ticketVersion.findMany({ where: { bookmakerId }, include: { legs: true } });
      expect(versions).toHaveLength(1);
      const version = versions[0]!;
      ticketVersionId = version.id;

      expect(version.tier).toBe("STANDARD");
      expect(version.relaxed).toBe(false);
      expect(version.confidenceThreshold).toBe(70);
      // combinedOdds is a Decimal(12,4) column, so it's rounded to 4 decimal places in storage.
      expect(Number(version.combinedOdds)).toBeCloseTo(expectedCombinedOdds, 3);
      expect(version.legs).toHaveLength(2);
      expect(new Set(version.legs.map((leg) => leg.fixtureId))).toEqual(new Set([fixture1Id, fixture2Id]));
      for (const leg of version.legs) expect(leg.selection).toBe("HOME");
    });

    it("settles the published ticket as a WIN once every leg's fixture finishes as predicted", async () => {
      await db.fixture.update({ where: { id: fixture1Id }, data: { status: "FINISHED", homeGoals: 2, awayGoals: 1 } });
      await db.fixture.update({ where: { id: fixture2Id }, data: { status: "FINISHED", homeGoals: 3, awayGoals: 0 } });

      const settleNow = new Date(kickoff2.getTime() + 60 * 60 * 1000);
      const result = await settleResults(settleNow);
      expect(result.settled).toBeGreaterThanOrEqual(1);

      const settlement = await db.settlement.findUniqueOrThrow({ where: { ticketVersionId } });
      expect(settlement.outcome).toBe("WIN");
      expect(Number(settlement.profitUnits)).toBeCloseTo(expectedCombinedOdds - 1, 3);

      // Re-running settlement must not create a second Settlement row (@@unique([ticketVersionId])
      // plus the "settlements: { none: {} }" candidate filter in settleResults).
      const rerun = await settleResults(new Date(settleNow.getTime() + 1000));
      const settlementsForTicket = await db.settlement.findMany({ where: { ticketVersionId } });
      expect(settlementsForTicket).toHaveLength(1);
      expect(rerun.settled).toBe(0);
    });
  });

  describe("tier disjointness: one publish run never puts a fixture on two tiers", () => {
    const RUN_SEED = randomInt(1, 90_000);
    const BASE = 600_000_000 + RUN_SEED * 1000;
    const POOL_SIZE = 10;
    const HISTORY_TARGET = 50;
    // Separate from the full-pipeline scenario's date range offset so the two suites' targetDates
    // (and selection windows) don't meet on the same run.
    const now = new Date(Date.UTC(2026, 1, 1, 9, 0, 0) + RUN_SEED * 24 * 60 * 60 * 1000);
    const capturedAt = new Date(now.getTime() - 30 * 60 * 1000);
    // Lower than the full-pipeline scenario's 1.3: at 1.3 three legs (~21.2) overshoot VALUE into HIGH.
    const HOME_GENEROSITY = 1.2;

    const competitionIds: string[] = [];
    const modelRunIds: string[] = [];
    const scenarioFixtureIds: string[] = [];
    let bookmakerId: string;
    let marketId: string;
    let homeOdds: number;

    // Same eligible-league recipe as the full-pipeline scenario: 50 FINISHED fixtures (every team
    // 9+ appearances) plus a hand-crafted, uniform-strength ModelRun, so every scenario fixture
    // gets the exact same HOME probability and therefore the exact same HOME odds and EV.
    async function seedEligibleCompetition(base: number, name: string): Promise<{ competitionId: string; teamIds: string[]; strengths: TeamStrengths }> {
      const competition = await db.competition.create({ data: { providerId: base + 1, name, country: null } });
      const teamIds: string[] = [];
      for (let i = 0; i < POOL_SIZE; i += 1) {
        teamIds.push((await db.team.create({ data: { providerId: base + 10 + i, name: `${name} Team ${i}` } })).id);
      }
      const pairs: Array<[number, number]> = [];
      for (let i = 0; i < POOL_SIZE; i += 1) for (let j = i + 1; j < POOL_SIZE; j += 1) pairs.push([i, j]);
      while (pairs.length < HISTORY_TARGET) pairs.push(pairs[pairs.length - 45]!);
      let providerId = base + 100;
      let daysAgo = HISTORY_TARGET;
      for (const [i, j] of pairs) {
        await db.fixture.create({
          data: {
            providerId: providerId++, competitionId: competition.id, homeTeamId: teamIds[i]!, awayTeamId: teamIds[j]!,
            kickoff: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000), status: "FINISHED", homeGoals: 1, awayGoals: 0
          }
        });
        daysAgo -= 1;
      }
      const strengths: TeamStrengths = {
        homeAdvantage: 1.3,
        leagueAverageGoals: 1.4,
        teams: Object.fromEntries(teamIds.map((id) => [id, { attack: 1, defense: 1, matchCount: HISTORY_TARGET }]))
      };
      const modelRun = await db.modelRun.create({ data: { competitionId: competition.id, version: "test", method: "dixon-coles-ipf-v1", trainedUntil: now, artifact: strengths as unknown as object } });
      competitionIds.push(competition.id);
      modelRunIds.push(modelRun.id);
      return { competitionId: competition.id, teamIds, strengths };
    }

    beforeAll(async () => {
      const leagueA = await seedEligibleCompetition(BASE, "Synthetic Disjoint League A");
      const leagueB = await seedEligibleCompetition(BASE + 500, "Synthetic Disjoint League B");

      // Five scenario fixtures, three in league A and two in league B, kicking off hourly. With
      // identical HOME odds (~2.56) STANDARD wants 2 legs (~6.5) and VALUE wants 3 (~16.7). Every
      // HOME candidate has the same EV, so tiers built independently would both start from the same
      // top-ranked fixtures -- exactly the overlap #18 forbids.
      const scenario: Array<[{ competitionId: string; teamIds: string[] }, number, number]> = [
        [leagueA, 0, 1], [leagueA, 2, 3], [leagueA, 4, 5], [leagueB, 0, 1], [leagueB, 2, 3]
      ];
      for (const [index, [league, home, away]] of scenario.entries()) {
        const fixture = await db.fixture.create({
          data: {
            providerId: BASE + 200 + index, competitionId: league.competitionId, homeTeamId: league.teamIds[home]!, awayTeamId: league.teamIds[away]!,
            kickoff: new Date(now.getTime() + (2 + index) * 60 * 60 * 1000), status: "SCHEDULED"
          }
        });
        scenarioFixtureIds.push(fixture.id);
      }

      const bookmaker = await db.bookmaker.create({ data: { providerId: BASE + 300, name: "Synthetic Disjoint Bookmaker", priority: 1, active: true } });
      bookmakerId = bookmaker.id;
      const market = await db.market.create({ data: { providerId: BASE + 310, name: "Match Winner", normalizedKey: "MATCH_WINNER", selectionEnabled: true } });
      marketId = market.id;

      const goals = expectedGoals(leagueA.teamIds[0]!, leagueA.teamIds[1]!, leagueA.strengths);
      const dist = dixonColesDistribution(goals.home, goals.away);
      homeOdds = HOME_GENEROSITY / dist.homeWin;
      // Preconditions the scenario depends on: 2 legs land in STANDARD, 3 legs land in VALUE.
      expect(homeOdds ** 2).toBeGreaterThanOrEqual(5);
      expect(homeOdds ** 2).toBeLessThan(10);
      expect(homeOdds ** 3).toBeGreaterThanOrEqual(10);
      expect(homeOdds ** 3).toBeLessThan(20);

      await generatePredictions(now);
      // generatePredictions may attach predictions to a leftover MATCH_WINNER market from an
      // aborted earlier run; quote against whichever market it actually used.
      marketId = (await db.prediction.findFirstOrThrow({ where: { fixtureId: scenarioFixtureIds[0]!, selection: "HOME" } })).marketId;

      for (const fixtureId of scenarioFixtureIds) {
        for (const [selection, decimalOdds] of [["HOME", homeOdds], ["DRAW", 1 / dist.draw], ["AWAY", 1 / dist.awayWin]] as const) {
          await db.oddsQuote.create({ data: { fixtureId, bookmakerId, marketId, selection, decimalOdds, capturedAt } });
        }
      }
    });

    afterAll(async () => {
      await db.prediction.deleteMany({ where: { fixtureId: { in: scenarioFixtureIds } } });
      await db.modelRun.deleteMany({ where: { id: { in: modelRunIds } } });
      await db.oddsQuote.deleteMany({ where: { fixtureId: { in: scenarioFixtureIds } } });
      await db.market.deleteMany({ where: { id: marketId } });
      await db.bookmaker.deleteMany({ where: { id: bookmakerId } });
    });

    it("publishes STANDARD and VALUE tickets whose persisted legs share no fixture", async () => {
      const result = await publishTickets(now);
      expect(result.published).toBeGreaterThanOrEqual(2);

      const versions = await db.ticketVersion.findMany({ where: { bookmakerId }, include: { legs: true } });
      const byTier = new Map(versions.map((version) => [version.tier, version]));
      expect([...byTier.keys()].sort()).toEqual(["STANDARD", "VALUE"]);
      expect(byTier.get("STANDARD")!.legs).toHaveLength(2);
      expect(byTier.get("VALUE")!.legs).toHaveLength(3);
      expect(Number(byTier.get("VALUE")!.combinedOdds)).toBeCloseTo(homeOdds ** 3, 3);

      // The actual #18 guarantee, checked on persisted TicketLeg rows: every fixture appears on at
      // most one ticket, and together the two tickets use all five scenario fixtures.
      const legFixtureIds = versions.flatMap((version) => version.legs.map((leg) => leg.fixtureId));
      expect(new Set(legFixtureIds).size).toBe(legFixtureIds.length);
      expect(new Set(legFixtureIds)).toEqual(new Set(scenarioFixtureIds));
    });

    it("keeps tiers disjoint when a re-run replaces the unlocked tickets", async () => {
      // Same day, still before the first kickoff: both tickets are unlocked, so the re-run
      // supersedes them. The live (unsuperseded) set must still be fixture-disjoint.
      const rerunNow = new Date(now.getTime() + 10 * 60 * 1000);
      await publishTickets(rerunNow);

      const live = await db.ticketVersion.findMany({ where: { bookmakerId, successors: { none: {} } }, include: { legs: true } });
      expect(live.map((version) => version.tier).sort()).toEqual(["STANDARD", "VALUE"]);
      const legFixtureIds = live.flatMap((version) => version.legs.map((leg) => leg.fixtureId));
      expect(new Set(legFixtureIds).size).toBe(legFixtureIds.length);
    });
  });

  describe("settleResults outcomes independent of publishTickets", () => {
    async function createStandaloneTicket(fixtureStatus: "POSTPONED" | "FINISHED" | "SCHEDULED", homeGoals: number | null, awayGoals: number | null, lockAt: Date) {
      const seed = randomInt(1, 90_000);
      const base = 750_000_000 + seed * 1000;
      const competition = await db.competition.create({ data: { providerId: base + 1, name: "Synthetic Settle League", country: null } });
      const homeTeam = await db.team.create({ data: { providerId: base + 2, name: "Synthetic Settle Home" } });
      const awayTeam = await db.team.create({ data: { providerId: base + 3, name: "Synthetic Settle Away" } });
      const fixture = await db.fixture.create({
        data: { providerId: base + 4, competitionId: competition.id, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, kickoff: lockAt, status: fixtureStatus, homeGoals, awayGoals }
      });
      const version = await db.ticketVersion.create({
        data: {
          targetDate: new Date("2026-02-01T00:00:00.000Z"), tier: "STANDARD", bookmakerId: `standalone-${base}`,
          combinedOdds: 6, confidenceThreshold: 70, relaxed: false, lockAt, decision: []
        }
      });
      await db.ticketLeg.create({ data: { ticketVersionId: version.id, fixtureId: fixture.id, quoteId: `standalone-quote-${base}`, marketKey: "MATCH_WINNER", selection: "HOME", decimalOdds: 6, probability: 0.5 } });
      return version.id;
    }

    it("voids a ticket when a leg's fixture was postponed", async () => {
      const lockAt = new Date("2026-02-01T10:00:00.000Z");
      const ticketVersionId = await createStandaloneTicket("POSTPONED", null, null, lockAt);

      const result = await settleResults(new Date(lockAt.getTime() + 60_000));
      expect(result.settled).toBeGreaterThanOrEqual(1);

      const settlement = await db.settlement.findUniqueOrThrow({ where: { ticketVersionId } });
      expect(settlement.outcome).toBe("VOID");
      expect(Number(settlement.profitUnits)).toBe(0);
    });

    it("settles a losing ticket with profitUnits of -1", async () => {
      const lockAt = new Date("2026-02-01T12:00:00.000Z");
      // HOME selection, but the away side won: a clean loss.
      const ticketVersionId = await createStandaloneTicket("FINISHED", 0, 2, lockAt);

      const result = await settleResults(new Date(lockAt.getTime() + 60_000));
      expect(result.settled).toBeGreaterThanOrEqual(1);

      const settlement = await db.settlement.findUniqueOrThrow({ where: { ticketVersionId } });
      expect(settlement.outcome).toBe("LOSS");
      expect(Number(settlement.profitUnits)).toBe(-1);
    });

    it("leaves a ticket pending when its fixture hasn't finished yet", async () => {
      const lockAt = new Date("2026-02-01T14:00:00.000Z");
      const ticketVersionId = await createStandaloneTicket("SCHEDULED", null, null, lockAt);

      const result = await settleResults(new Date(lockAt.getTime() + 60_000));
      expect(result.pending).toBeGreaterThanOrEqual(1);

      const settlement = await db.settlement.findUnique({ where: { ticketVersionId } });
      expect(settlement).toBeNull();
    });
  });

  describe("refreshPendingResults", () => {
    it("re-fetches a fixture that finished after being ingested as SCHEDULED, unblocking settlement", async () => {
      const seed = randomInt(1, 90_000);
      const base = 780_000_000 + seed * 1000;
      const competition = await db.competition.create({ data: { providerId: base + 1, name: "Synthetic Refresh League", country: null } });
      const homeTeam = await db.team.create({ data: { providerId: base + 2, name: "Synthetic Refresh Home" } });
      const awayTeam = await db.team.create({ data: { providerId: base + 3, name: "Synthetic Refresh Away" } });
      const kickoff = new Date("2026-03-01T12:00:00.000Z");
      const fixture = await db.fixture.create({ data: { providerId: base + 4, competitionId: competition.id, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, kickoff, status: "SCHEDULED" } });

      const version = await db.ticketVersion.create({
        data: { targetDate: new Date("2026-03-01T00:00:00.000Z"), tier: "STANDARD", bookmakerId: `standalone-${base}`, combinedOdds: 6, confidenceThreshold: 70, relaxed: false, lockAt: kickoff, decision: [] }
      });
      await db.ticketLeg.create({ data: { ticketVersionId: version.id, fixtureId: fixture.id, quoteId: `standalone-quote-${base}`, marketKey: "MATCH_WINNER", selection: "HOME", decimalOdds: 6, probability: 0.5 } });

      // The test DB accumulates permanent TicketVersion/TicketLeg rows across every run of this
      // suite (they're append-only), so refreshPendingResults' query legitimately picks up other
      // stale pending fixtures too, not just this one. The fake only resolves the batch(es)
      // containing *this* fixture's providerId, so assertions stay correct regardless of what
      // else has piled up.
      const now = new Date(kickoff.getTime() + 2 * 60 * 60 * 1000);
      const requestedIds: number[] = [];
      const fakeClient = {
        getPaged: async (_endpoint: string, query: Record<string, string | number | undefined>) => {
          const batchIds = String(query.ids).split("-").map(Number);
          requestedIds.push(...batchIds);
          if (!batchIds.includes(fixture.providerId)) return [];
          return [{
            fixture: { id: fixture.providerId, date: kickoff.toISOString(), status: { short: "FT" } },
            league: { id: competition.providerId, name: "Synthetic Refresh League", country: null },
            teams: { home: { id: homeTeam.providerId, name: "Synthetic Refresh Home" }, away: { id: awayTeam.providerId, name: "Synthetic Refresh Away" } },
            goals: { home: 2, away: 0 }
          }];
        }
      };

      const refreshResult = await refreshPendingResults(now, fakeClient);
      expect(refreshResult.refreshed).toBeGreaterThanOrEqual(1);
      expect(requestedIds).toContain(fixture.providerId);

      const updated = await db.fixture.findUniqueOrThrow({ where: { id: fixture.id } });
      expect(updated.status).toBe("FINISHED");
      expect(updated.homeGoals).toBe(2);
      expect(updated.awayGoals).toBe(0);

      const settleResult = await settleResults(now);
      expect(settleResult.settled).toBeGreaterThanOrEqual(1);
      const settlement = await db.settlement.findUniqueOrThrow({ where: { ticketVersionId: version.id } });
      expect(settlement.outcome).toBe("WIN");
    });

    it("does not request a SCHEDULED fixture that no pending ticket depends on", async () => {
      const seed = randomInt(1, 90_000);
      const base = 785_000_000 + seed * 1000;
      const competition = await db.competition.create({ data: { providerId: base + 1, name: "Synthetic Untouched League", country: null } });
      const homeTeam = await db.team.create({ data: { providerId: base + 2, name: "Synthetic Untouched Home" } });
      const awayTeam = await db.team.create({ data: { providerId: base + 3, name: "Synthetic Untouched Away" } });
      const kickoff = new Date("2026-03-02T12:00:00.000Z");
      const fixture = await db.fixture.create({ data: { providerId: base + 4, competitionId: competition.id, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, kickoff, status: "SCHEDULED" } });

      // Other accumulated pending tickets from earlier tests may still trigger calls of their own;
      // what this asserts is that *this* untied fixture is never among the requested IDs.
      const requestedIds: number[] = [];
      const fakeClient = { getPaged: async (_endpoint: string, query: Record<string, string | number | undefined>) => { requestedIds.push(...String(query.ids).split("-").map(Number)); return []; } };
      await refreshPendingResults(new Date(kickoff.getTime() + 60 * 60 * 1000), fakeClient);

      expect(requestedIds).not.toContain(fixture.providerId);
    });
  });
});
