import { db } from "@highodds/db";
import { blantyreDayBounds, resolveSelection } from "@highodds/core";

export const TOTAL_GOALS_RULE_KEY = "TOTAL_GOALS_ODDS_1_80_V1";
export const TOTAL_GOALS_RULE_MIN_ODDS = 1.8;

type ValidationPickRow = {
  fixtureId: string; kickoff: Date; status: string; homeGoals: number | null; awayGoals: number | null;
  homeTeam: string; awayTeam: string; competition: string; selection: string; probability: number;
  decimalOdds: number; capturedAt: Date; bookmaker: string;
};

export type TotalGoalsRulePick = {
  fixtureId: string; kickoff: Date; status: string; homeTeam: string; awayTeam: string; competition: string;
  selection: "OVER_2_5" | "UNDER_2_5"; probability: number; odds: number; capturedAt: Date; bookmaker: string;
  outcome: "WIN" | "LOSS" | "PENDING" | "VOID";
};

type Performance = {
  selection: "ALL" | "OVER_2_5" | "UNDER_2_5"; picks: number; settled: number; pending: number; voids: number;
  wins: number; hitRate: number | null; expectedHitRate: number | null; profitUnits: number; roiPercent: number | null;
};

function performance(selection: Performance["selection"], rows: TotalGoalsRulePick[]): Performance {
  const settled = rows.filter((row) => row.outcome === "WIN" || row.outcome === "LOSS");
  const wins = settled.filter((row) => row.outcome === "WIN").length;
  const profitUnits = settled.reduce((sum, row) => sum + (row.outcome === "WIN" ? row.odds - 1 : -1), 0);
  return {
    selection, picks: rows.length, settled: settled.length,
    pending: rows.filter((row) => row.outcome === "PENDING").length,
    voids: rows.filter((row) => row.outcome === "VOID").length,
    wins, hitRate: settled.length === 0 ? null : wins / settled.length,
    expectedHitRate: rows.length === 0 ? null : rows.reduce((sum, row) => sum + row.probability, 0) / rows.length,
    profitUnits, roiPercent: settled.length === 0 ? null : profitUnits / settled.length * 100
  };
}

export type TotalGoalsRuleDay = { day: string; picks: TotalGoalsRulePick[]; performance: Performance[] };

/** Reads immutable daily rule snapshots captured by PUBLISH_TICKETS. */
export async function loadTotalGoalsRuleDay(day: string): Promise<TotalGoalsRuleDay> {
  const { start, end } = blantyreDayBounds(day);
  const rows = await db.$queryRaw<ValidationPickRow[]>`
    SELECT vp."fixtureId", f."kickoff", f."status", f."homeGoals", f."awayGoals",
      ht."name" AS "homeTeam", at."name" AS "awayTeam", c."name" AS "competition",
      vp."selection", vp."probability"::float8 AS "probability", vp."decimalOdds"::float8 AS "decimalOdds",
      vp."capturedAt", b."name" AS "bookmaker"
    FROM "ValidationPick" vp
      JOIN "Fixture" f ON f."id" = vp."fixtureId"
      JOIN "Team" ht ON ht."id" = f."homeTeamId"
      JOIN "Team" at ON at."id" = f."awayTeamId"
      JOIN "Competition" c ON c."id" = f."competitionId"
      JOIN "OddsQuote" q ON q."id" = vp."quoteId"
      JOIN "Bookmaker" b ON b."id" = q."bookmakerId"
    WHERE vp."ruleKey" = ${TOTAL_GOALS_RULE_KEY}
      AND f."kickoff" >= ${start} AND f."kickoff" < ${end}
    ORDER BY f."kickoff" ASC, vp."fixtureId" ASC`;

  const picks = rows.map((row) => {
    const resolved = row.homeGoals === null || row.awayGoals === null ? null : resolveSelection("TOTAL_GOALS", row.selection, row.homeGoals, row.awayGoals);
    const voided = row.status === "POSTPONED" || row.status === "CANCELLED";
    return {
      fixtureId: row.fixtureId, kickoff: row.kickoff, status: row.status, homeTeam: row.homeTeam, awayTeam: row.awayTeam,
      competition: row.competition, selection: row.selection as TotalGoalsRulePick["selection"], probability: row.probability,
      odds: row.decimalOdds, capturedAt: row.capturedAt, bookmaker: row.bookmaker,
      outcome: resolved ?? (voided ? "VOID" : "PENDING")
    } satisfies TotalGoalsRulePick;
  });
  const over = picks.filter((row) => row.selection === "OVER_2_5");
  const under = picks.filter((row) => row.selection === "UNDER_2_5");
  return { day, picks, performance: [performance("OVER_2_5", over), performance("UNDER_2_5", under), performance("ALL", picks)] };
}
