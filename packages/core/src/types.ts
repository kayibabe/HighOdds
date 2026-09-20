export type DecimalOdds = number;

export type SupportedMarket = "MATCH_WINNER" | "TOTAL_GOALS" | "BTTS";

export interface Quote {
  bookmakerId: string;
  fixtureId: string;
  market: SupportedMarket;
  selection: string;
  decimalOdds: DecimalOdds;
  capturedAt: Date;
}

export interface CandidateLeg extends Quote {
  modelProbability: number;
  consensusProbability: number;
  conservativeExpectedValue: number;
  confidenceScore: number;
  leagueId: string;
  kickoff: Date;
}

export interface TicketTier {
  key: "STANDARD" | "VALUE" | "HIGH";
  minOdds: number;
  maxOddsExclusive: number | null;
}

export interface TicketDraft {
  tier: TicketTier;
  bookmakerId: string;
  legs: CandidateLeg[];
  combinedOdds: number;
  confidenceThreshold: number;
  relaxed: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}
