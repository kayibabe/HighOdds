"use client";

import { useEffect, useState } from "react";

const STAKE_EVENT = "highodds:research-stake-change";
const money = new Intl.NumberFormat("en-MW", { style: "currency", currency: "MWK", currencyDisplay: "symbol", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function validStake(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(1_000_000, parsed) : 0;
}

function publishStake(value: string): void {
  const url = new URL(window.location.href);
  if (value.trim() === "") url.searchParams.delete("stake");
  else url.searchParams.set("stake", value);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new CustomEvent<number>(STAKE_EVENT, { detail: validStake(value) }));
}

export function ResearchStakeInput({ initialStake }: { initialStake: number }) {
  return <label>Stake / selection (MWK)<input name="stake" type="number" min="0.01" max="1000000" step="0.01" defaultValue={initialStake.toFixed(2)} onChange={(event) => publishStake(event.currentTarget.value)} /></label>;
}

function useResearchStake(initialStake: number): number {
  const [stake, setStake] = useState(initialStake);
  useEffect(() => {
    const onStakeChange = (event: Event) => setStake((event as CustomEvent<number>).detail);
    window.addEventListener(STAKE_EVENT, onStakeChange);
    return () => window.removeEventListener(STAKE_EVENT, onStakeChange);
  }, []);
  return stake;
}

export function ResearchPerformanceSummary({ initialStake, settledCount, wins, losses, voids, pending, returnsPerUnit, netPerUnit, roiPercent }: {
  initialStake: number; settledCount: number; wins: number; losses: number; voids: number; pending: number;
  returnsPerUnit: number; netPerUnit: number; roiPercent: number | null;
}) {
  const stake = useResearchStake(initialStake);
  const totalStake = settledCount * stake;
  const returns = returnsPerUnit * stake;
  const net = netPerUnit * stake;
  return <div className="research-performance" aria-label="Selection performance summary">
    <article><small>Settled</small><strong>{settledCount}</strong><span>{wins} won · {losses} lost · {voids} void · {pending} pending</span></article>
    <article><small>Total stake</small><strong>{settledCount && stake ? money.format(totalStake) : "—"}</strong><span>{money.format(stake)} per settled selection</span></article>
    <article><small>Returns</small><strong>{settledCount && stake ? money.format(returns) : "—"}</strong><span>wins paid at captured odds</span></article>
    <article><small>Net P&amp;L</small><strong className={net > 0 ? "positive" : net < 0 ? "negative" : ""}>{settledCount && stake ? `${net > 0 ? "+" : ""}${money.format(net)}` : "—"}</strong><span>after settled selections</span></article>
    <article><small>ROI</small><strong className={roiPercent !== null && roiPercent > 0 ? "positive" : roiPercent !== null && roiPercent < 0 ? "negative" : ""}>{roiPercent === null ? "—" : `${roiPercent > 0 ? "+" : ""}${roiPercent.toFixed(1)}%`}</strong><span>net P&amp;L ÷ stake</span></article>
  </div>;
}

export function ResearchMoneyCell({ initialStake, profitUnits }: { initialStake: number; profitUnits: number | null }) {
  const stake = useResearchStake(initialStake);
  const value = profitUnits === null ? null : profitUnits * stake;
  return <td className={`num ${value !== null ? value > 0 ? "positive" : value < 0 ? "negative" : "" : ""}`}>{value === null || !stake ? "—" : `${value > 0 ? "+" : ""}${money.format(value)}`}</td>;
}
