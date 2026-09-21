import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@highodds/db";
import { ingestFixtures, ingestOdds } from "../src/ingestion.js";
import capturedOdds from "./fixtures/odds-brighton-arsenal.json" with { type: "json" };

/**
 * Exercises ingestFixtures/ingestOdds against a real local Postgres (docker-compose.yml's
 * "postgres" service). Skipped when DATABASE_URL isn't set, since it needs a live database,
 * not just the pure-function coverage in markets.test.ts.
 *
 * Every provider ID this suite writes is synthetic, including the ones derived from the "real
 * elapsed fixture" payload below -- normalizeMarket/normalizeSelection key off the provider's
 * *name* strings, not its numeric IDs, so remapping the IDs doesn't change what's under test.
 * IDs are also randomized per run (RUN_SEED below): a `_test`-suffixed database only proves intent,
 * not that it's empty or exclusive to this run, so fixed IDs could still collide with leftovers
 * from a previous run or a concurrent one. This suite's afterAll deletes rows by provider ID; real
 * API-Football IDs (e.g. competition ID 39 for the Premier League, or bookmaker ID 8 for Bet365)
 * must never appear here, or this cleanup could delete real rows on a shared database.
 */
const RUN_SEED = randomInt(1, 90_000);
const BASE = 900_000_000 + RUN_SEED * 1000;

const FUTURE_FIXTURE_PROVIDER_ID = BASE + 1;
const FUTURE_COMPETITION_PROVIDER_ID = BASE + 2;
const FUTURE_HOME_TEAM_PROVIDER_ID = BASE + 3;
const FUTURE_AWAY_TEAM_PROVIDER_ID = BASE + 4;
const FUTURE_BOOKMAKER_PROVIDER_ID = BASE + 5;

const PAST_FIXTURE_PROVIDER_ID = BASE + 10; // synthetic ID for the already-elapsed fixture; markets.test.ts uses the real one (1557409) for its own, read-only, non-DB assertions
const PAST_COMPETITION_PROVIDER_ID = BASE + 11;
const PAST_HOME_TEAM_PROVIDER_ID = BASE + 12;
const PAST_AWAY_TEAM_PROVIDER_ID = BASE + 13;

const PAST_BOOKMAKER_PROVIDER_IDS = { bet365: BASE + 20, williamHill: BASE + 21, marathonbet: BASE + 22 } as const;
// Shared by both tests below, since Market rows are upserted by providerId across the whole suite.
const SYNTHETIC_MARKET_PROVIDER_IDS = { matchWinner: BASE + 30, goalsOverUnder: BASE + 31, bothTeamsScore: BASE + 32, goalsOverUnderFirstHalf: BASE + 33, firstHalfWinner: BASE + 34, goalsOverUnderSecondHalf: BASE + 35 } as const;

const BOOKMAKER_ID_REMAP: Record<number, number> = { 8: PAST_BOOKMAKER_PROVIDER_IDS.bet365, 7: PAST_BOOKMAKER_PROVIDER_IDS.williamHill, 2: PAST_BOOKMAKER_PROVIDER_IDS.marathonbet };
const MARKET_ID_REMAP: Record<number, number> = { 1: SYNTHETIC_MARKET_PROVIDER_IDS.matchWinner, 5: SYNTHETIC_MARKET_PROVIDER_IDS.goalsOverUnder, 8: SYNTHETIC_MARKET_PROVIDER_IDS.bothTeamsScore, 6: SYNTHETIC_MARKET_PROVIDER_IDS.goalsOverUnderFirstHalf, 13: SYNTHETIC_MARKET_PROVIDER_IDS.firstHalfWinner, 26: SYNTHETIC_MARKET_PROVIDER_IDS.goalsOverUnderSecondHalf };

/** Throws instead of falling back to the real ID, so a future edit to the captured fixture can't silently reintroduce a real provider ID into the database. */
function requireMappedId(map: Record<number, number>, id: number, kind: string): number {
  const mapped = map[id];
  if (mapped === undefined) {
    throw new Error(`Unmapped ${kind} provider ID ${id} in odds-brighton-arsenal.json -- add a synthetic ID mapping in ingestion.integration.test.ts before this payload can be written to the database.`);
  }
  return mapped;
}

/** Keeps the real capture's names, odds, and timing but swaps every provider ID for a synthetic one, so DB writes never touch real API-Football IDs. */
function synthesizeOddsPayload(fixtureProviderId: number) {
  return {
    fixture: { id: fixtureProviderId },
    update: capturedOdds.update,
    bookmakers: capturedOdds.bookmakers.map((bookmaker) => ({
      id: requireMappedId(BOOKMAKER_ID_REMAP, bookmaker.id, "bookmaker"),
      name: bookmaker.name,
      bets: bookmaker.bets.map((bet) => ({ id: requireMappedId(MARKET_ID_REMAP, bet.id, "market"), name: bet.name, values: bet.values }))
    }))
  };
}

const databaseUrl = process.env.DATABASE_URL;
const isTestDatabase = !!databaseUrl && /\/[^/?]*_test(\?|$)/.test(databaseUrl);

describe.skipIf(!databaseUrl)("ingestOdds persistence and pre-kickoff rejection (live DB)", () => {
  beforeAll(() => {
    if (!isTestDatabase) {
      throw new Error(
        `Refusing to run ingestion.integration.test.ts against DATABASE_URL="${databaseUrl}": its database name ` +
        `must end with "_test" (e.g. highodds_test). This suite deletes rows by provider ID in afterAll and must ` +
        `never run against a database that could hold real data.`
      );
    }
  });

  afterAll(async () => {
    await db.oddsQuote.deleteMany({ where: { fixture: { providerId: { in: [FUTURE_FIXTURE_PROVIDER_ID, PAST_FIXTURE_PROVIDER_ID] } } } });
    await db.fixture.deleteMany({ where: { providerId: { in: [FUTURE_FIXTURE_PROVIDER_ID, PAST_FIXTURE_PROVIDER_ID] } } });
    await db.competition.deleteMany({ where: { providerId: { in: [FUTURE_COMPETITION_PROVIDER_ID, PAST_COMPETITION_PROVIDER_ID] } } });
    await db.team.deleteMany({ where: { providerId: { in: [FUTURE_HOME_TEAM_PROVIDER_ID, FUTURE_AWAY_TEAM_PROVIDER_ID, PAST_HOME_TEAM_PROVIDER_ID, PAST_AWAY_TEAM_PROVIDER_ID] } } });
    await db.bookmaker.deleteMany({ where: { providerId: { in: [FUTURE_BOOKMAKER_PROVIDER_ID, ...Object.values(PAST_BOOKMAKER_PROVIDER_IDS)] } } });
    await db.market.deleteMany({ where: { providerId: { in: Object.values(SYNTHETIC_MARKET_PROVIDER_IDS) } } });
  });

  it("persists only the accepted quotes for a fixture that has not kicked off yet", async () => {
    const kickoff = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await ingestFixtures([{
      fixture: { id: FUTURE_FIXTURE_PROVIDER_ID, date: kickoff.toISOString(), status: { short: "NS" } },
      league: { id: FUTURE_COMPETITION_PROVIDER_ID, name: "Test League", country: null },
      teams: { home: { id: FUTURE_HOME_TEAM_PROVIDER_ID, name: "Test Home FC" }, away: { id: FUTURE_AWAY_TEAM_PROVIDER_ID, name: "Test Away FC" } },
      goals: { home: null, away: null }
    }]);

    const oddsResult = await ingestOdds([{
      fixture: { id: FUTURE_FIXTURE_PROVIDER_ID },
      update: new Date().toISOString(),
      bookmakers: [{
        id: FUTURE_BOOKMAKER_PROVIDER_ID, name: "Bet365",
        bets: [
          { id: SYNTHETIC_MARKET_PROVIDER_IDS.matchWinner, name: "Match Winner", values: [{ value: "Home", odd: "1.44" }, { value: "Draw", odd: "4.75" }, { value: "Away", odd: "7.00" }] },
          { id: SYNTHETIC_MARKET_PROVIDER_IDS.goalsOverUnder, name: "Goals Over/Under", values: [{ value: "Over 1.5", odd: "1.25" }, { value: "Under 1.5", odd: "4.00" }, { value: "Over 2.5", odd: "1.80" }, { value: "Under 2.5", odd: "2.00" }] },
          { id: SYNTHETIC_MARKET_PROVIDER_IDS.bothTeamsScore, name: "Both Teams Score", values: [{ value: "Yes", odd: "1.75" }, { value: "No", odd: "2.00" }] }
        ]
      }]
    }]);

    // 3 (Match Winner) + 2 (only the 2.5 line) + 2 (BTTS) accepted; the 1.5 line is rejected.
    expect(oddsResult).toEqual({ quotes: 7, rejected: 2 });

    const fixture = await db.fixture.findUniqueOrThrow({ where: { providerId: FUTURE_FIXTURE_PROVIDER_ID } });
    const quotes = await db.oddsQuote.findMany({ where: { fixtureId: fixture.id }, include: { market: true } });
    expect(quotes).toHaveLength(7);

    const bySelection = new Map(quotes.map((q) => [`${q.market.normalizedKey}:${q.selection}`, Number(q.decimalOdds)]));
    expect(bySelection.get("MATCH_WINNER:HOME")).toBe(1.44);
    expect(bySelection.get("TOTAL_GOALS:OVER_2_5")).toBe(1.8);
    expect(bySelection.get("TOTAL_GOALS:UNDER_2_5")).toBe(2);
    expect(bySelection.get("BTTS:YES")).toBe(1.75);
    expect(bySelection.has("TOTAL_GOALS:OVER_1_5")).toBe(false);

    const goalsMarket = await db.market.findUniqueOrThrow({ where: { providerId: SYNTHETIC_MARKET_PROVIDER_IDS.goalsOverUnder } });
    expect(goalsMarket.normalizedKey).toBe("TOTAL_GOALS");
    expect(goalsMarket.selectionEnabled).toBe(true);
  });

  it("rejects every quote for a real, already-elapsed fixture and persists nothing", async () => {
    await ingestFixtures([{
      fixture: { id: PAST_FIXTURE_PROVIDER_ID, date: "2026-09-19T14:00:00.000Z", status: { short: "FT" } },
      league: { id: PAST_COMPETITION_PROVIDER_ID, name: "Premier League", country: "England" },
      teams: { home: { id: PAST_HOME_TEAM_PROVIDER_ID, name: "Brighton" }, away: { id: PAST_AWAY_TEAM_PROVIDER_ID, name: "Arsenal" } },
      goals: { home: 3, away: 0 }
    }]);

    const totalValues = capturedOdds.bookmakers.reduce(
      (sum, bookmaker) => sum + bookmaker.bets.reduce((betSum, bet) => betSum + bet.values.length, 0),
      0
    );

    const oddsResult = await ingestOdds([synthesizeOddsPayload(PAST_FIXTURE_PROVIDER_ID)]);

    // capturedAt (ingestion time, "now") is after this fixture's 2026-09-19 kickoff, so every value is rejected
    // regardless of whether it would otherwise have normalized -- this is what makes pre-kickoff rejection real,
    // not just a plausible-sounding assertion about a fixture that happens to also be unsupported.
    expect(oddsResult).toEqual({ quotes: 0, rejected: totalValues });

    const persisted = await db.oddsQuote.count({ where: { fixture: { providerId: PAST_FIXTURE_PROVIDER_ID } } });
    expect(persisted).toBe(0);
  });
});
