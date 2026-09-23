"use client";

import { useEffect, useRef, useState } from "react";

export type TicketLegData = {
  id: string;
  home: string;
  away: string;
  competition: string;
  kickoff: string;
  fixtureStatus: string;
  homeGoals: number | null;
  awayGoals: number | null;
  market: string;
  selection: string;
  odds: number;
  probability: number;
  quoteCapturedAt: string | null;
  consensusProbability: number | null;
  agreementScore: number | null;
};

export type TicketCardData = {
  id: string;
  tier: string;
  combinedOdds: number;
  confidenceThreshold: number;
  relaxed: boolean;
  publishedAt: string;
  lockAt: string;
  bookmaker: string | null;
  outcome: string;
  legs: TicketLegData[];
};

type SelectedLeg = { ticket: TicketCardData; leg: TicketLegData };
type DetailView = "overview" | "probability" | "odds" | "result";

const TIER_LABEL: Record<string, string> = { STANDARD: "Standard", VALUE: "Value", HIGH: "High" };
const LOCAL_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Blantyre", weekday: "short", day: "2-digit", month: "short",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

function time(iso: string): string {
  return `${LOCAL_TIME.format(new Date(iso))} CAT`;
}

function utcTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16) + " UTC";
}

function pct(probability: number): string {
  return `${(probability * 100).toFixed(1)}%`;
}

function selectionLabel(selection: string): string {
  if (selection === "HOME") return "Home win";
  if (selection === "AWAY") return "Away win";
  if (selection === "DRAW") return "Draw";
  if (selection === "YES") return "Yes";
  if (selection === "NO") return "No";
  const total = /^(OVER|UNDER)_([0-9]+)_([0-9]+)$/.exec(selection);
  return total ? `${total[1] === "OVER" ? "Over" : "Under"} ${total[2]}.${total[3]}` : selection;
}

function DetailPanel({ selected, onClose }: { selected: SelectedLeg; onClose: () => void }) {
  const [view, setView] = useState<DetailView>("overview");
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const { ticket, leg } = selected;
  const implied = leg.odds > 0 ? 1 / leg.odds : null;
  const gap = implied === null ? null : (leg.probability - implied) * 100;
  const score = leg.homeGoals !== null && leg.awayGoals !== null ? `${leg.homeGoals}–${leg.awayGoals}` : null;

  useEffect(() => {
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const controls = panelRef.current?.querySelectorAll<HTMLButtonElement>("button");
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const views: { id: DetailView; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "probability", label: "Probability" },
    { id: "odds", label: "Odds source" },
    { id: "result", label: "Result" }
  ];

  return (
    <div className="selection-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panelRef} className="selection-panel" role="dialog" aria-modal="true" aria-labelledby="selection-title">
        <div className="selection-panel-head">
          <div>
            <p className="eyebrow">SELECTION EVIDENCE · PAPER RESEARCH</p>
            <h2 id="selection-title">{leg.home} <span>vs</span> {leg.away}</h2>
            <p>{leg.competition} · <strong>{time(leg.kickoff)}</strong></p>
          </div>
          <button ref={closeRef} type="button" className="selection-close" onClick={onClose} aria-label="Close selection details">×</button>
        </div>

        <div className="selection-panel-chips">
          <span className="selection-chip">{TIER_LABEL[ticket.tier] ?? ticket.tier} ticket</span>
          <span className="selection-chip">{ticket.outcome.toLowerCase()} ticket</span>
          {ticket.relaxed && <span className="selection-chip caution">Relaxed criteria</span>}
        </div>

        <div className="selection-evidence-card">
          <div className="selection-evidence-head"><strong>Published snapshot</strong><span>Leg-level review · advisory</span></div>
          <div className="selection-evidence-grid">
            <div><small>Model estimate</small><strong>{pct(leg.probability)}</strong></div>
            <div><small>Bookmaker implied</small><strong>{implied === null ? "Unavailable" : pct(implied)}</strong></div>
            <div><small>Model / market agreement</small><strong>{leg.agreementScore === null ? "Unavailable" : `${leg.agreementScore.toFixed(0)}/100`}</strong></div>
            <div><small>Market consensus</small><strong>{leg.consensusProbability === null ? "Unavailable" : pct(leg.consensusProbability)}</strong></div>
          </div>
          <p>These are recorded estimates and prices from publication, not a guarantee or a current betting price.</p>
        </div>

        <div className="selection-facts">
          <div><small>Market</small><strong>{leg.market}: {selectionLabel(leg.selection)}</strong></div>
          <div><small>Snapshot odds</small><strong>{leg.odds.toFixed(2)}×</strong></div>
          <div><small>Fixture status</small><strong>{leg.fixtureStatus.toLowerCase()}</strong></div>
          <div><small>Score</small><strong>{score ?? "Not recorded"}</strong></div>
        </div>

        <nav className="selection-tabs" aria-label="Selection detail sections">
          {views.map((item) => (
            <button key={item.id} type="button" className={view === item.id ? "active" : ""} aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>
          ))}
        </nav>

        <div className="selection-view">
          {view === "overview" && <>
            <h3>Selection overview</h3>
            <dl>
              <div><dt>Published selection</dt><dd>{leg.market}: {selectionLabel(leg.selection)}</dd></div>
              <div><dt>Kickoff</dt><dd>{time(leg.kickoff)}</dd></div>
              <div><dt>Ticket published</dt><dd>{utcTime(ticket.publishedAt)}</dd></div>
              <div><dt>Ticket lock</dt><dd>{utcTime(ticket.lockAt)}</dd></div>
              <div><dt>Confidence floor</dt><dd>{ticket.confidenceThreshold}%</dd></div>
            </dl>
            <p>This leg belongs to a published paper ticket. The confidence floor is a ticket selection rule, not this match&apos;s win probability.</p>
          </>}
          {view === "probability" && <>
            <h3>Probability evidence</h3>
            <dl>
              <div><dt>Published model estimate</dt><dd>{pct(leg.probability)}</dd></div>
              <div><dt>Bookmaker implied probability</dt><dd>{implied === null ? "Unavailable" : pct(implied)}</dd></div>
              <div><dt>Model minus implied</dt><dd>{gap === null ? "Unavailable" : `${gap >= 0 ? "+" : ""}${gap.toFixed(1)} percentage points`}</dd></div>
              <div><dt>De-vigged market consensus</dt><dd>{leg.consensusProbability === null ? "Unavailable" : pct(leg.consensusProbability)}</dd></div>
              <div><dt>Model / market agreement</dt><dd>{leg.agreementScore === null ? "Unavailable" : `${leg.agreementScore.toFixed(0)}/100`}</dd></div>
            </dl>
            <p>The gap compares a model estimate with a single bookmaker&apos;s price. It is a review signal, not verified value. Consensus and agreement appear only when the matching publication snapshot is stored.</p>
          </>}
          {view === "odds" && <>
            <h3>Recorded odds source</h3>
            <dl>
              <div><dt>Bookmaker</dt><dd>{ticket.bookmaker ?? "Unavailable"}</dd></div>
              <div><dt>Decimal odds</dt><dd>{leg.odds.toFixed(2)}×</dd></div>
              <div><dt>Captured at</dt><dd>{leg.quoteCapturedAt ? utcTime(leg.quoteCapturedAt) : "Unavailable"}</dd></div>
              <div><dt>Published at</dt><dd>{utcTime(ticket.publishedAt)}</dd></div>
            </dl>
            <p>This is the quote recorded for the published leg. Check the bookmaker for any current price.</p>
          </>}
          {view === "result" && <>
            <h3>Recorded result</h3>
            <dl>
              <div><dt>Fixture status</dt><dd>{leg.fixtureStatus.toLowerCase()}</dd></div>
              <div><dt>Stored score</dt><dd>{score ?? "Not recorded"}</dd></div>
              <div><dt>Whole ticket outcome</dt><dd>{ticket.outcome.toLowerCase()}</dd></div>
            </dl>
            <p>HighOdds records settlement at ticket level. A separate settlement outcome for this leg is not stored.</p>
          </>}
        </div>
      </section>
    </div>
  );
}

export default function TicketBoard({ tickets }: { tickets: TicketCardData[] }) {
  const [selected, setSelected] = useState<SelectedLeg | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const close = () => {
    setSelected(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  if (tickets.length === 0) return null;

  return (
    <>
      <div className="ticket-board-heading">
        <div><p className="eyebrow">PRIMARY RESEARCH OUTPUT</p><h2>Published recommendations</h2></div>
        <p>Open a match for its recorded model, market, odds, and result details.</p>
      </div>
      <div className="ticket-cards">
        {tickets.map((ticket) => (
          <article key={ticket.id} className={`ticket-card premium-ticket tier-${ticket.tier.toLowerCase()}`}>
            <div className="premium-ticket-top">
              <div className="premium-ticket-title">
                <h3><span className="tier-dot" />{TIER_LABEL[ticket.tier] ?? ticket.tier}</h3>
                <div className="premium-ticket-tags">
                  <span className="selection-chip">{ticket.outcome.toLowerCase()} · {ticket.legs.length} legs</span>
                  {ticket.relaxed && <span className="selection-chip caution">Relaxed criteria</span>}
                </div>
              </div>
              <div className="premium-ticket-stats">
                <div><small>Ticket odds</small><strong>{ticket.combinedOdds.toFixed(2)}×</strong></div>
                <div><small>Legs</small><strong>{ticket.legs.length}</strong></div>
                <div><small>Confidence floor</small><strong>{ticket.confidenceThreshold}%</strong></div>
                <div><small>Locks</small><strong>{time(ticket.lockAt)}</strong></div>
              </div>
              <div className="premium-ticket-meta">
                <span>Bookmaker <strong>{ticket.bookmaker ?? "Unavailable"}</strong></span>
                <span>Published {utcTime(ticket.publishedAt)}</span>
                <span>Paper research</span>
              </div>
            </div>
            <ul className="premium-leg-list" aria-label={`${TIER_LABEL[ticket.tier] ?? ticket.tier} ticket legs`}>
              {ticket.legs.map((leg) => {
                const implied = leg.odds > 0 ? 1 / leg.odds : null;
                const gap = implied === null ? null : (leg.probability - implied) * 100;
                return (
                  <li key={leg.id}>
                    <button type="button" className="premium-leg-trigger" aria-haspopup="dialog" aria-label={`View evidence for ${leg.home} vs ${leg.away}`} onClick={(event) => { triggerRef.current = event.currentTarget; setSelected({ ticket, leg }); }}>
                      <span className="premium-leg-main">
                        <strong>{leg.home} <span>vs</span> {leg.away}</strong>
                        <small>{leg.competition} · {time(leg.kickoff)}</small>
                        <span className="premium-leg-market">{leg.market}: {selectionLabel(leg.selection)}</span>
                      </span>
                      <span className="premium-leg-numbers">
                        <strong>{leg.odds.toFixed(2)}×</strong>
                        <small>Model {pct(leg.probability)}</small>
                        {gap !== null && <small className="premium-leg-gap">{gap >= 0 ? "+" : ""}{gap.toFixed(1)} pp vs implied</small>}
                      </span>
                      <span className="premium-leg-arrow" aria-hidden="true">›</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </article>
        ))}
      </div>
      {selected && <DetailPanel key={selected.leg.id} selected={selected} onClose={close} />}
    </>
  );
}
