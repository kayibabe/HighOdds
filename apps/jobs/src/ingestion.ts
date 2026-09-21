import { db } from "@highodds/db";
import { normalizeMarket, normalizeSelection } from "./markets.js";

type ProviderFixture = {
  fixture?: { id?: number; date?: string; status?: { short?: string } };
  league?: { id?: number; name?: string; country?: string | null };
  teams?: { home?: { id?: number; name?: string }; away?: { id?: number; name?: string } };
  goals?: { home?: number | null; away?: number | null };
};

type ProviderOdds = {
  fixture?: { id?: number };
  update?: string;
  bookmakers?: Array<{ id?: number; name?: string; bets?: Array<{ id?: number; name?: string; values?: Array<{ value?: string; odd?: string }> }> }>;
};

function fixtureStatus(shortStatus?: string): "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED" {
  if (["FT", "AET", "PEN"].includes(shortStatus ?? "")) return "FINISHED";
  if (["PST", "SUSP", "ABD"].includes(shortStatus ?? "")) return "POSTPONED";
  if (["CANC", "AWD", "WO"].includes(shortStatus ?? "")) return "CANCELLED";
  if (["1H", "HT", "2H", "ET", "BT", "P"].includes(shortStatus ?? "")) return "LIVE";
  return "SCHEDULED";
}

export async function ingestFixtures(records: unknown[]): Promise<{ ingested: number; rejected: number }> {
  let ingested = 0; let rejected = 0;
  for (const record of records as ProviderFixture[]) {
    const fixture = record.fixture; const league = record.league; const home = record.teams?.home; const away = record.teams?.away;
    if (!fixture?.id || !fixture.date || !league?.id || !league.name || !home?.id || !home.name || !away?.id || !away.name) { rejected += 1; continue; }
    const kickoff = new Date(fixture.date);
    if (Number.isNaN(kickoff.getTime())) { rejected += 1; continue; }
    const [competition, homeTeam, awayTeam] = await db.$transaction([
      db.competition.upsert({ where: { providerId: league.id }, create: { providerId: league.id, name: league.name, country: league.country ?? null }, update: { name: league.name, country: league.country ?? null } }),
      db.team.upsert({ where: { providerId: home.id }, create: { providerId: home.id, name: home.name }, update: { name: home.name } }),
      db.team.upsert({ where: { providerId: away.id }, create: { providerId: away.id, name: away.name }, update: { name: away.name } })
    ]);
    await db.fixture.upsert({
      where: { providerId: fixture.id },
      create: { providerId: fixture.id, competitionId: competition.id, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, kickoff, status: fixtureStatus(fixture.status?.short), homeGoals: record.goals?.home ?? null, awayGoals: record.goals?.away ?? null },
      update: { competitionId: competition.id, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, kickoff, status: fixtureStatus(fixture.status?.short), homeGoals: record.goals?.home ?? null, awayGoals: record.goals?.away ?? null, receivedAt: new Date() }
    });
    ingested += 1;
  }
  return { ingested, rejected };
}

/** Captures every returned bookmaker/market/selection quote; duplicates are history, not overwrite candidates. */
export async function ingestOdds(records: unknown[]): Promise<{ quotes: number; rejected: number }> {
  let quotes = 0; let rejected = 0;
  const capturedAt = new Date();
  for (const record of records as ProviderOdds[]) {
    if (!record.fixture?.id) { rejected += 1; continue; }
    const fixture = await db.fixture.findUnique({ where: { providerId: record.fixture.id }, select: { id: true, kickoff: true } });
    if (!fixture) { rejected += 1; continue; }
    const providerUpdatedAt = record.update ? new Date(record.update) : null;
    for (const providerBookmaker of record.bookmakers ?? []) {
      if (!providerBookmaker.id || !providerBookmaker.name) { rejected += 1; continue; }
      const bookmaker = await db.bookmaker.upsert({ where: { providerId: providerBookmaker.id }, create: { providerId: providerBookmaker.id, name: providerBookmaker.name }, update: { name: providerBookmaker.name } });
      for (const providerMarket of providerBookmaker.bets ?? []) {
        if (!providerMarket.id || !providerMarket.name) { rejected += 1; continue; }
        const normalizedKey = normalizeMarket(providerMarket.name);
        const market = await db.market.upsert({
          where: { providerId: providerMarket.id },
          create: { providerId: providerMarket.id, name: providerMarket.name, normalizedKey, selectionEnabled: normalizedKey !== null },
          update: { name: providerMarket.name, normalizedKey, selectionEnabled: normalizedKey !== null }
        });
        for (const value of providerMarket.values ?? []) {
          const decimalOdds = Number(value.odd);
          const selection = normalizedKey && value.value ? normalizeSelection(normalizedKey, value.value) : null;
          if (!selection || !Number.isFinite(decimalOdds) || decimalOdds <= 1 || capturedAt >= fixture.kickoff) { rejected += 1; continue; }
          await db.oddsQuote.create({ data: { fixtureId: fixture.id, bookmakerId: bookmaker.id, marketId: market.id, selection, decimalOdds, providerUpdatedAt: providerUpdatedAt && !Number.isNaN(providerUpdatedAt.getTime()) ? providerUpdatedAt : null, capturedAt } });
          quotes += 1;
        }
      }
    }
  }
  return { quotes, rejected };
}
