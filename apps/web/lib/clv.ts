import { db } from "@highodds/db";
import { clvPercent, type QuoteCadenceInput } from "@highodds/core";

export interface TicketQuoteCadence extends QuoteCadenceInput {
  ticketVersionId: string;
}

/**
 * Reads only captured prices that were available before kickoff. A CLV value requires a strictly
 * later quote than the entry quote; repeating the entry price is coverage failure, not 0% CLV.
 */
export async function loadTicketQuoteCadence(ticketIds: string[]): Promise<TicketQuoteCadence[]> {
  if (ticketIds.length === 0) return [];
  const legs = await db.ticketLeg.findMany({
    where: { ticketVersionId: { in: ticketIds } },
    include: { ticketVersion: { select: { bookmakerId: true, publishedAt: true } }, fixture: { select: { kickoff: true } } }
  });
  const fixtureIds = [...new Set(legs.map((leg) => leg.fixtureId))];
  if (fixtureIds.length === 0) return [];
  const [quotes, bookmakers] = await Promise.all([
    db.oddsQuote.findMany({ where: { fixtureId: { in: fixtureIds } }, select: { id: true, fixtureId: true, bookmakerId: true, marketId: true, selection: true, decimalOdds: true, capturedAt: true } }),
    db.bookmaker.findMany({ select: { id: true, name: true } })
  ]);
  const quoteById = new Map(quotes.map((quote) => [quote.id, quote]));
  const bookmakerName = new Map(bookmakers.map((bookmaker) => [bookmaker.id, bookmaker.name]));
  const quoteKey = (quote: Pick<(typeof quotes)[number], "fixtureId" | "bookmakerId" | "marketId" | "selection">) =>
    `${quote.fixtureId}:${quote.bookmakerId}:${quote.marketId}:${quote.selection}`;
  const quoteGroups = new Map<string, typeof quotes>();
  for (const quote of quotes) {
    const group = quoteGroups.get(quoteKey(quote)) ?? [];
    group.push(quote); quoteGroups.set(quoteKey(quote), group);
  }
  for (const group of quoteGroups.values()) group.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());

  return legs.flatMap((leg) => {
    const entry = quoteById.get(leg.quoteId);
    if (!entry) return [];
    const group = quoteGroups.get(quoteKey(entry)) ?? [];
    const beforeKickoff = group.filter((quote) => quote.capturedAt < leg.fixture.kickoff);
    const postPublication = beforeKickoff.filter((quote) => quote.capturedAt > leg.ticketVersion.publishedAt);
    const later = beforeKickoff.filter((quote) => quote.capturedAt > entry.capturedAt).at(-1);
    return [{
      ticketVersionId: leg.ticketVersionId, marketKey: leg.marketKey,
      bookmaker: bookmakerName.get(entry.bookmakerId) ?? entry.bookmakerId,
      postPublicationUpdates: postPublication.length,
      clvPercent: later ? clvPercent(Number(leg.decimalOdds), Number(later.decimalOdds)) : null
    }];
  });
}

/** Mean observable CLV across ticket legs. Missing later quotes are deliberately excluded. */
export async function averageClv(ticketIds: string[]): Promise<number | null> {
  const rows = await loadTicketQuoteCadence(ticketIds);
  const values = rows.flatMap((row) => row.clvPercent === null ? [] : [row.clvPercent]);
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}
