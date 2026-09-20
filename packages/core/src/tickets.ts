import type { CandidateLeg, EligibilityResult, TicketDraft, TicketTier } from "./types.js";
import { MIN_LEG_ODDS, quoteIsFresh } from "./odds.js";

export const TICKET_TIERS: TicketTier[] = [
  { key: "STANDARD", minOdds: 5, maxOddsExclusive: 10 },
  { key: "VALUE", minOdds: 10, maxOddsExclusive: 20 },
  { key: "HIGH", minOdds: 20, maxOddsExclusive: null }
];

export function legEligibility(leg: CandidateLeg, now: Date): EligibilityResult {
  if (leg.decimalOdds < MIN_LEG_ODDS) return { eligible: false, reason: "ODDS_BELOW_1_80" };
  if (leg.conservativeExpectedValue <= 0) return { eligible: false, reason: "NON_POSITIVE_CONSERVATIVE_EV" };
  if (!quoteIsFresh(leg, leg.kickoff, now)) return { eligible: false, reason: "STALE_OR_POST_KICKOFF_QUOTE" };
  return { eligible: true };
}

function product(legs: CandidateLeg[]): number { return legs.reduce((value, leg) => value * leg.decimalOdds, 1); }
function inTier(odds: number, tier: TicketTier): boolean { return odds >= tier.minOdds && (tier.maxOddsExclusive === null || odds < tier.maxOddsExclusive); }

function chooseLegs(candidates: CandidateLeg[], tier: TicketTier): CandidateLeg[] | null {
  const search = (start: number, selected: CandidateLeg[]): CandidateLeg[] | null => {
    const odds = product(selected);
    if (selected.length >= 2 && inTier(odds, tier)) return selected;
    if (tier.maxOddsExclusive !== null && odds >= tier.maxOddsExclusive) return null;
    for (let index = start; index < candidates.length; index += 1) {
      const next = candidates[index]!;
      if (selected.some((leg) => leg.fixtureId === next.fixtureId || leg.leagueId === next.leagueId && selected.filter((leg) => leg.leagueId === next.leagueId).length >= 2)) continue;
      const result = search(index + 1, [...selected, next]);
      if (result) return result;
    }
    return null;
  };
  return search(0, []);
}

/** Creates only placeable same-bookmaker drafts; returns no draft when gates cannot be met. */
export function buildTickets(candidates: CandidateLeg[], bookmakerPriority: string[], now: Date): TicketDraft[] {
  const drafts: TicketDraft[] = [];
  for (const tier of TICKET_TIERS) {
    let draft: TicketDraft | undefined;
    for (const threshold of [70, 65, 60]) {
      for (const bookmakerId of bookmakerPriority) {
        const viable = candidates.filter((candidate) => candidate.bookmakerId === bookmakerId && candidate.confidenceScore >= threshold && legEligibility(candidate, now).eligible)
          .sort((a, b) => b.conservativeExpectedValue - a.conservativeExpectedValue);
        const legs = chooseLegs(viable, tier);
        if (legs) {
          draft = { tier, bookmakerId, legs, combinedOdds: product(legs), confidenceThreshold: threshold, relaxed: threshold < 70 };
          break;
        }
      }
      if (draft) break;
    }
    if (draft) drafts.push(draft);
  }
  return drafts;
}
