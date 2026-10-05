import { db } from "@highodds/db";
import { MAX_TICKET_ODDS_FIXTURES_PER_TICK, TICKET_ODDS_REFRESH_MINUTES } from "@highodds/core";
import { getOddsWithProvenance, type OddsProviderClient } from "./api-football.js";
import { ingestOdds } from "./ingestion.js";

const REFRESH_INTERVAL_MS = TICKET_ODDS_REFRESH_MINUTES * 60 * 1000;

export type TicketOddsRefreshResult = {
  eligible: number;
  requested: number;
  captured: number;
  rejected: number;
};

type TicketFixture = {
  providerId: number;
  kickoff: Date;
  quotes: Array<{ capturedAt: Date }>;
  ticketLegs: Array<{ ticketVersion: { publishedAt: Date } }>;
};

/**
 * Returns a targeted list of current paper-ticket fixtures that need a later price observation.
 * A capture after the latest current publication is required at least once; thereafter a fixture
 * is refreshed only when its latest local quote is older than the bounded cadence interval.
 */
export function ticketFixturesNeedingOddsRefresh(now: Date, fixtures: TicketFixture[]): TicketFixture[] {
  const staleBefore = new Date(now.getTime() - REFRESH_INTERVAL_MS);
  return fixtures
    .filter((fixture) => {
      const latestPublication = fixture.ticketLegs.reduce<Date | null>((latest, leg) =>
        !latest || leg.ticketVersion.publishedAt > latest ? leg.ticketVersion.publishedAt : latest, null);
      const latestQuote = fixture.quotes[0]?.capturedAt;
      return !latestPublication || !latestQuote || latestQuote <= latestPublication || latestQuote < staleBefore;
    })
    .sort((left, right) => left.kickoff.getTime() - right.kickoff.getTime())
    .slice(0, MAX_TICKET_ODDS_FIXTURES_PER_TICK);
}

/**
 * Captures fresh provider quotes only for non-superseded, not-yet-started paper-ticket legs.
 * It never changes a published decision or its entry quote; ingestOdds only appends quote history.
 */
export async function refreshPublishedTicketOdds(
  now: Date,
  client: OddsProviderClient,
  ingest = ingestOdds
): Promise<TicketOddsRefreshResult> {
  const fixtures = await db.fixture.findMany({
    where: {
      status: "SCHEDULED",
      kickoff: { gt: now },
      ticketLegs: { some: { ticketVersion: { publishedAt: { lt: now }, successors: { none: {} } } } }
    },
    select: {
      providerId: true,
      kickoff: true,
      quotes: { where: { capturedAt: { lt: now } }, orderBy: { capturedAt: "desc" }, take: 1, select: { capturedAt: true } },
      ticketLegs: {
        where: { ticketVersion: { publishedAt: { lt: now }, successors: { none: {} } } },
        select: { ticketVersion: { select: { publishedAt: true } } }
      }
    }
  });
  const targets = ticketFixturesNeedingOddsRefresh(now, fixtures);
  let captured = 0;
  let rejected = 0;
  for (const fixture of targets) {
    const result = await ingest(await getOddsWithProvenance(client, { fixture: fixture.providerId }));
    captured += result.quotes;
    rejected += result.rejected;
  }
  return { eligible: fixtures.length, requested: targets.length, captured, rejected };
}
