import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@highodds/db";
import { ingestFixtures, ingestOdds } from "../src/ingestion.js";
import capturedOdds from "./fixtures/odds-brighton-arsenal.json" with { type: "json" };

/**
 * Exercises ingestFixtures/ingestOdds against a real local Postgres (docker-compose.yml's
 * "postgres" service). Skipped when DATABASE_URL isn't set, since it needs a live database,
 * not just the pure-function coverage in markets.test.ts.
 */
const FUTURE_FIXTURE_PROVIDER_ID = 900000001;
const PAST_FIXTURE_PROVIDER_ID = 1557409; // the real, already-elapsed fixture markets.test.ts is built from

describe.skipIf(!process.env.DATABASE_URL)("ingestOdds persistence and pre-kickoff rejection (live DB)", () => {
  afterAll(async () => {
    await db.oddsQuote.deleteMany({ where: { fixture: { providerId: { in: [FUTURE_FIXTURE_PROVIDER_ID, PAST_FIXTURE_PROVIDER_ID] } } } });
    await db.fixture.deleteMany({ where: { providerId: { in: [FUTURE_FIXTURE_PROVIDER_ID, PAST_FIXTURE_PROVIDER_ID] } } });
    await db.competition.deleteMany({ where: { providerId: { in: [900000001, 39] } } });
    await db.team.deleteMany({ where: { providerId: { in: [900000002, 900000003, 900000004, 900000005] } } });
    await db.bookmaker.deleteMany({ where: { providerId: { in: [900000008, 8, 7, 2] } } });
    await db.market.deleteMany({ where: { providerId: { in: [1, 5, 8, 6, 13, 26] } } });
  });

  it("persists only the accepted quotes for a fixture that has not kicked off yet", async () => {
    const kickoff = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await ingestFixtures([{
      fixture: { id: FUTURE_FIXTURE_PROVIDER_ID, date: kickoff.toISOString(), status: { short: "NS" } },
      league: { id: 900000001, name: "Test League", country: null },
      teams: { home: { id: 900000002, name: "Test Home FC" }, away: { id: 900000003, name: "Test Away FC" } },
      goals: { home: null, away: null }
    }]);

    const oddsResult = await ingestOdds([{
      fixture: { id: FUTURE_FIXTURE_PROVIDER_ID },
      update: new Date().toISOString(),
      bookmakers: [{
        id: 900000008, name: "Bet365",
        bets: [
          { id: 1, name: "Match Winner", values: [{ value: "Home", odd: "1.44" }, { value: "Draw", odd: "4.75" }, { value: "Away", odd: "7.00" }] },
          { id: 5, name: "Goals Over/Under", values: [{ value: "Over 1.5", odd: "1.25" }, { value: "Under 1.5", odd: "4.00" }, { value: "Over 2.5", odd: "1.80" }, { value: "Under 2.5", odd: "2.00" }] },
          { id: 8, name: "Both Teams Score", values: [{ value: "Yes", odd: "1.75" }, { value: "No", odd: "2.00" }] }
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

    const goalsMarket = await db.market.findUniqueOrThrow({ where: { providerId: 5 } });
    expect(goalsMarket.normalizedKey).toBe("TOTAL_GOALS");
    expect(goalsMarket.selectionEnabled).toBe(true);
  });

  it("rejects every quote for a real, already-elapsed fixture and persists nothing", async () => {
    await ingestFixtures([{
      fixture: { id: PAST_FIXTURE_PROVIDER_ID, date: "2026-09-19T14:00:00.000Z", status: { short: "FT" } },
      league: { id: 39, name: "Premier League", country: "England" },
      teams: { home: { id: 900000004, name: "Brighton" }, away: { id: 900000005, name: "Arsenal" } },
      goals: { home: 3, away: 0 }
    }]);

    const totalValues = capturedOdds.bookmakers.reduce(
      (sum, bookmaker) => sum + bookmaker.bets.reduce((betSum, bet) => betSum + bet.values.length, 0),
      0
    );

    const oddsResult = await ingestOdds([{ fixture: { id: PAST_FIXTURE_PROVIDER_ID }, update: capturedOdds.update, bookmakers: capturedOdds.bookmakers }]);

    // capturedAt (ingestion time, "now") is after this fixture's 2026-09-19 kickoff, so every value is rejected
    // regardless of whether it would otherwise have normalized -- this is what makes pre-kickoff rejection real,
    // not just a plausible-sounding assertion about a fixture that happens to also be unsupported.
    expect(oddsResult).toEqual({ quotes: 0, rejected: totalValues });

    const persisted = await db.oddsQuote.count({ where: { fixture: { providerId: PAST_FIXTURE_PROVIDER_ID } } });
    expect(persisted).toBe(0);
  });
});
