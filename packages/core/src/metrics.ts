export interface SettlementRecord {
  tier: "STANDARD" | "VALUE" | "HIGH";
  outcome: "WIN" | "LOSS" | "VOID" | "PENDING";
  profitUnits: number | null;
}

export interface TierRoi {
  tier: "STANDARD" | "VALUE" | "HIGH";
  settled: number;
  wins: number;
  losses: number;
  voids: number;
  staked: number;
  profitUnits: number;
  roiPercent: number;
}

/** Stakes 1 unit per settled ticket; PENDING settlements are excluded from ROI. */
export function computeRoi(settlements: SettlementRecord[]): TierRoi[] {
  const tiers: Array<"STANDARD" | "VALUE" | "HIGH"> = ["STANDARD", "VALUE", "HIGH"];
  return tiers.map((tier) => {
    const rows = settlements.filter((row) => row.tier === tier && row.outcome !== "PENDING");
    const staked = rows.length;
    const profitUnits = rows.reduce((sum, row) => sum + (row.profitUnits ?? 0), 0);
    return {
      tier,
      settled: rows.length,
      wins: rows.filter((row) => row.outcome === "WIN").length,
      losses: rows.filter((row) => row.outcome === "LOSS").length,
      voids: rows.filter((row) => row.outcome === "VOID").length,
      staked,
      profitUnits,
      roiPercent: staked > 0 ? (profitUnits / staked) * 100 : 0
    };
  });
}

/** Positive means the entry price was better than the closing price (beat the close). */
export function clvPercent(entryOdds: number, closingOdds: number): number {
  if (entryOdds <= 1 || closingOdds <= 1) throw new Error("Odds must be greater than 1");
  return (entryOdds / closingOdds - 1) * 100;
}
