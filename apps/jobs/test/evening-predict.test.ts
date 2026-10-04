import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ fixtures: vi.fn(), markets: vi.fn(), model: vi.fn(), existing: vi.fn(), create: vi.fn() }));
vi.mock("@highodds/db", () => ({ db: { fixture: { findMany: mock.fixtures }, market: { findMany: mock.markets }, modelRun: { findFirst: mock.model }, prediction: { findFirst: mock.existing, create: mock.create } } }));
import { generatePredictions } from "../src/predict.js";

describe("preliminary forecast generation", () => {
  const evening = new Date("2026-10-04T20:00:00Z");
  const fixture = { id: "future", competitionId: "league", homeTeamId: "home", awayTeamId: "away", kickoff: new Date("2026-10-05T21:00:00Z") };
  const history = Array.from({ length: 50 }, (_, index) => ({ kickoff: new Date(evening.getTime() - (index + 1) * 86400000), homeTeamId: "home", awayTeamId: "away", homeGoals: 1, awayGoals: 0 }));
  let stored: Array<Record<string, unknown>>;
  beforeEach(() => {
    vi.clearAllMocks(); stored = [];
    mock.fixtures.mockImplementation(async (args) => args.where.status === "SCHEDULED" ? [fixture] : history);
    mock.markets.mockResolvedValue([{ id: "winner", normalizedKey: "MATCH_WINNER" }, { id: "goals", normalizedKey: "TOTAL_GOALS" }, { id: "btts", normalizedKey: "BTTS" }]);
    mock.model.mockResolvedValue({ id: "model", artifact: { homeAdvantage: 1.3, leagueAverageGoals: 1.4, teams: { home: { attack: 1, defense: 1 }, away: { attack: 1, defense: 1 } } } });
    mock.existing.mockImplementation(async ({ where }) => stored.find(row => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null);
    mock.create.mockImplementation(async ({ data }) => { stored.push(data); return data; });
  });
  it("stores all seven market outcomes for tomorrow's late game with pinned scope and lineage", async () => {
    expect(await generatePredictions(evening, { stage: "PRELIMINARY", targetDate: "2026-10-05" })).toEqual({ predicted: 7, skipped: 0 });
    expect(mock.fixtures.mock.calls[0][0].where.kickoff).toEqual({ gte: new Date("2026-10-04T22:00:00Z"), lt: new Date("2026-10-05T22:00:00Z") });
    expect(stored.every(row => row.stage === "PRELIMINARY" && row.asOfAt === evening && row.modelRunId === "model")).toBe(true);
    expect(mock.model.mock.calls[0][0].where.trainedUntil).toEqual({ lte: evening });
    expect(mock.fixtures.mock.calls[1][0].where.receivedAt).toEqual({ lte: evening });
    expect(mock.fixtures.mock.calls[1][0].where.kickoff.lt).toBe(evening);
  });
  it("is idempotent within a stage but refreshes in the morning even with the same model", async () => {
    const options = { stage: "PRELIMINARY" as const, targetDate: "2026-10-05" };
    await generatePredictions(evening, options);
    expect((await generatePredictions(evening, options)).predicted).toBe(0);
    const morning = new Date("2026-10-05T05:45:00Z");
    expect((await generatePredictions(morning)).predicted).toBe(7);
    expect(stored.filter(row => row.stage === "SELECTION")).toHaveLength(7);
    expect(stored.filter(row => row.stage === "PRELIMINARY")).toHaveLength(7);
  });
  it("keeps the history floor and produces no picks for an untrained league", async () => {
    mock.fixtures.mockImplementation(async (args) => args.where.status === "SCHEDULED" ? [fixture] : history.slice(0, 49));
    expect(await generatePredictions(evening, { stage: "PRELIMINARY", targetDate: "2026-10-05" })).toEqual({ predicted: 0, skipped: 1 });
    expect(mock.create).not.toHaveBeenCalled();
    mock.model.mockResolvedValue(null);
    expect((await generatePredictions(evening, { stage: "PRELIMINARY", targetDate: "2026-10-05" })).skipped).toBe(1);
  });
});
