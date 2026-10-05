import type { CandidateLeg, EligibilityResult, TicketDraft, TicketTier } from "./types.js";
import { impliedProbability, MIN_LEG_ODDS, quoteIsFresh } from "./odds.js";

export const TICKET_TIERS: TicketTier[] = [
  { key: "STANDARD", minOdds: 5, maxOddsExclusive: 10 },
  { key: "VALUE", minOdds: 10, maxOddsExclusive: 20 },
  { key: "HIGH", minOdds: 20, maxOddsExclusive: null }
];

/**
 * A narrow selection-layer safeguard for the price band under review.  This is deliberately
 * independent of the model/market agreement score: it evaluates the selected quote's implied
 * probability against the already-produced model probability.
 *
 * It is a prospective, paper-only control rather than evidence that this segment is profitable.
 */
export const AWAY_WIN_GUARD_MIN_ODDS = 1.8;
export const AWAY_WIN_GUARD_MAX_ODDS_EXCLUSIVE = 2;
export const AWAY_WIN_GUARD_MIN_MODEL_IMPLIED_EDGE = 0.05;

/**
 * Paper-only response to the prospective leg review. It intentionally removes Away match-winner
 * legs from the higher accumulator tiers and rejects their long-shot Standard-tier tail. This is
 * a pre-declared observation rule, not a claim that the retained segment has an edge.
 */
export const AWAY_WIN_STANDARD_MIN_MODEL_PROBABILITY = 0.35;
export const AWAY_WIN_STANDARD_MAX_ODDS_EXCLUSIVE = 4;

export function modelImpliedEdge(leg: Pick<CandidateLeg, "modelProbability" | "decimalOdds">): number {
  return leg.modelProbability - impliedProbability(leg.decimalOdds);
}

export function isGuardedAwayWin(leg: Pick<CandidateLeg, "market" | "selection" | "decimalOdds">): boolean {
  return leg.market === "MATCH_WINNER" && leg.selection === "AWAY"
    && leg.decimalOdds >= AWAY_WIN_GUARD_MIN_ODDS && leg.decimalOdds < AWAY_WIN_GUARD_MAX_ODDS_EXCLUSIVE;
}

export function legEligibility(leg: CandidateLeg, now: Date): EligibilityResult {
  if (leg.decimalOdds < MIN_LEG_ODDS) return { eligible: false, reason: "ODDS_BELOW_1_80" };
  if (isGuardedAwayWin(leg) && modelImpliedEdge(leg) < AWAY_WIN_GUARD_MIN_MODEL_IMPLIED_EDGE) {
    return { eligible: false, reason: "AWAY_WIN_1_80_1_99_MODEL_EDGE_BELOW_5PP" };
  }
  if (leg.conservativeExpectedValue <= 0) return { eligible: false, reason: "NON_POSITIVE_CONSERVATIVE_EV" };
  if (!quoteIsFresh(leg, leg.kickoff, now)) return { eligible: false, reason: "STALE_OR_POST_KICKOFF_QUOTE" };
  return { eligible: true };
}

/** Tier-specific layer on top of the universal leg gates, retained in candidate snapshots. */
export function legEligibilityForTier(leg: CandidateLeg, tier: TicketTier, now: Date): EligibilityResult {
  const base = legEligibility(leg, now);
  if (!base.eligible) return base;
  if (leg.market !== "MATCH_WINNER" || leg.selection !== "AWAY") return base;
  if (tier.key === "VALUE" || tier.key === "HIGH") return { eligible: false, reason: "AWAY_WIN_NOT_ALLOWED_IN_VALUE_HIGH" };
  if (leg.modelProbability < AWAY_WIN_STANDARD_MIN_MODEL_PROBABILITY) return { eligible: false, reason: "AWAY_WIN_STANDARD_MODEL_PROBABILITY_BELOW_35PCT" };
  if (leg.decimalOdds >= AWAY_WIN_STANDARD_MAX_ODDS_EXCLUSIVE) return { eligible: false, reason: "AWAY_WIN_STANDARD_ODDS_4_00_OR_HIGHER" };
  return base;
}

function product(legs: CandidateLeg[]): number { return legs.reduce((value, leg) => value * leg.decimalOdds, 1); }
function inTier(odds: number, tier: TicketTier): boolean { return odds >= tier.minOdds && (tier.maxOddsExclusive === null || odds < tier.maxOddsExclusive); }

/** A ticket is an accumulator: it needs at least this many legs. */
export const MIN_TICKET_LEGS = 2;
/** No ticket carries more than this many legs from one competition. */
export const MAX_LEGS_PER_LEAGUE = 2;

function chooseLegs(candidates: CandidateLeg[], tier: TicketTier): CandidateLeg[] | null {
  const search = (start: number, selected: CandidateLeg[]): CandidateLeg[] | null => {
    const odds = product(selected);
    if (selected.length >= MIN_TICKET_LEGS && inTier(odds, tier)) return selected;
    if (tier.maxOddsExclusive !== null && odds >= tier.maxOddsExclusive) return null;
    for (let index = start; index < candidates.length; index += 1) {
      const next = candidates[index]!;
      if (selected.some((leg) => leg.fixtureId === next.fixtureId || leg.leagueId === next.leagueId && selected.filter((leg) => leg.leagueId === next.leagueId).length >= MAX_LEGS_PER_LEAGUE)) continue;
      const result = search(index + 1, [...selected, next]);
      if (result) return result;
    }
    return null;
  };
  return search(0, []);
}

/** Model/market agreement floors, strictest first; a tier relaxes down this list only when it must. */
export const CONFIDENCE_THRESHOLDS = [70, 65, 60] as const;

export interface BuildTicketsOptions {
  /** Fixtures already committed to tickets that stay live (e.g. locked tiers); no draft may reuse them. */
  reservedFixtureIds?: Iterable<string>;
  /** Tiers whose existing ticket stays live, so no draft is built for them. */
  skipTiers?: Iterable<TicketTier["key"]>;
}

function draftAt(candidates: CandidateLeg[], bookmakerPriority: string[], tier: TicketTier, threshold: number, now: Date, excluded: Set<string>): TicketDraft | undefined {
  for (const bookmakerId of bookmakerPriority) {
    const viable = candidates.filter((candidate) => candidate.bookmakerId === bookmakerId && candidate.confidenceScore >= threshold && !excluded.has(candidate.fixtureId) && legEligibilityForTier(candidate, tier, now).eligible)
      .sort((a, b) => b.conservativeExpectedValue - a.conservativeExpectedValue);
    const legs = chooseLegs(viable, tier);
    if (legs) return { tier, bookmakerId, legs, combinedOdds: product(legs), confidenceThreshold: threshold, relaxed: threshold < CONFIDENCE_THRESHOLDS[0] };
  }
  return undefined;
}

/**
 * Creates only placeable same-bookmaker drafts; returns no draft when gates cannot be met.
 * Tiers never share a fixture, so one losing match can't sink several tickets at once. Tiers are
 * filled in order (STANDARD first gets the best legs), and a tier only relaxes its confidence
 * threshold as far as it would have to without that exclusion: a tier is skipped rather than
 * built from weaker legs just to avoid overlap.
 */
export function buildTickets(candidates: CandidateLeg[], bookmakerPriority: string[], now: Date, options: BuildTicketsOptions = {}): TicketDraft[] {
  const drafts: TicketDraft[] = [];
  const reserved = new Set(options.reservedFixtureIds ?? []);
  const skipTiers = new Set(options.skipTiers ?? []);
  for (const tier of TICKET_TIERS) {
    if (skipTiers.has(tier.key)) continue;
    const baseline = CONFIDENCE_THRESHOLDS.findIndex((threshold) => draftAt(candidates, bookmakerPriority, tier, threshold, now, new Set()) !== undefined);
    if (baseline === -1) continue;
    let draft: TicketDraft | undefined;
    for (const threshold of CONFIDENCE_THRESHOLDS.slice(0, baseline + 1)) {
      draft = draftAt(candidates, bookmakerPriority, tier, threshold, now, reserved);
      if (draft) break;
    }
    if (!draft) continue;
    drafts.push(draft);
    for (const leg of draft.legs) reserved.add(leg.fixtureId);
  }
  return drafts;
}

export interface LiveTicket { tier: TicketTier["key"]; locked: boolean; fixtureIds: string[]; }

/**
 * Builds drafts for a day that may already have live tickets. Locked tickets always stay; an
 * unlocked one stays when this run produces no replacement for its tier. Fixtures of every ticket
 * that stays are reserved, and since reserving can knock out further tiers, rebuild until the
 * kept set stops growing (at most one pass per tier).
 */
export function buildTicketsAround(candidates: CandidateLeg[], bookmakerPriority: string[], now: Date, live: LiveTicket[]): TicketDraft[] {
  const liveByTier = new Map(live.map((ticket) => [ticket.tier, ticket]));
  const kept = new Set(live.filter((ticket) => ticket.locked).map((ticket) => ticket.tier));
  for (;;) {
    const drafts = buildTickets(candidates, bookmakerPriority, now, {
      skipTiers: kept,
      reservedFixtureIds: [...kept].flatMap((tier) => liveByTier.get(tier)!.fixtureIds)
    });
    const drafted = new Set(drafts.map((draft) => draft.tier.key));
    const unreplaced = [...liveByTier.keys()].filter((tier) => !kept.has(tier) && !drafted.has(tier));
    if (unreplaced.length === 0) return drafts;
    for (const tier of unreplaced) kept.add(tier);
  }
}
