import { TOTAL_GOALS_RULE_MIN_ODDS, type TotalGoalsRuleDay, type TotalGoalsRulePick } from "../../lib/total-goals";

const pct = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const roi = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
const label = (selection: string) => selection === "OVER_2_5" ? "Over 2.5" : selection === "UNDER_2_5" ? "Under 2.5" : "All total-goals picks";
const time = (value: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Blantyre", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value);
const dateTime = (value: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Blantyre", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value);

function outcome(pick: TotalGoalsRulePick) {
  return pick.outcome === "PENDING" ? "Pending" : pick.outcome === "WIN" ? "Won" : "Lost";
}

export default function TotalGoalsRule({ data }: { data: TotalGoalsRuleDay }) {
  return <section className="total-goals-rule" aria-labelledby="total-goals-rule-title">
    <div className="ticket-board-heading">
      <div><p className="eyebrow">LOCKED PAPER VALIDATION</p><h2 id="total-goals-rule-title">Total Goals ≥ {TOTAL_GOALS_RULE_MIN_ODDS.toFixed(2)}</h2></div>
      <p>Daily prospective cohort. One model pick per fixture, only when the recorded pre-kickoff price is at least {TOTAL_GOALS_RULE_MIN_ODDS.toFixed(2)}. Over and Under are evaluated separately; ticket generation is not involved.</p>
    </div>
    <div className="analysis-kpis compact total-goals-rule-kpis">
      {data.performance.map((row) => <article key={row.selection}><small>{label(row.selection)}</small><strong>{row.picks}</strong><span>{row.settled} settled · {row.pending} pending</span><span>{pct(row.hitRate)} hit · {roi(row.roiPercent)} ROI</span></article>)}
    </div>
    {data.picks.length === 0 ? <div className="notice">No Total Goals model pick met the fixed {TOTAL_GOALS_RULE_MIN_ODDS.toFixed(2)} odds rule on this date.</div> : <>
      <div className="matches-table-wrap">
        <table className="analysis-table total-goals-rule-table">
          <caption>Daily selections and recorded outcomes</caption>
          <thead><tr><th>Kickoff</th><th>Match</th><th>Pick</th><th>Model</th><th>Odds</th><th>Bookmaker</th><th>Quote captured</th><th>Status</th></tr></thead>
          <tbody>{data.picks.map((pick) => <tr key={pick.fixtureId}>
            <td className="num">{time(pick.kickoff)}</td><th scope="row">{pick.homeTeam} vs {pick.awayTeam}<small>{pick.competition}</small></th>
            <td>{label(pick.selection)}</td><td className="num">{pct(pick.probability)}</td><td className="num">{pick.odds.toFixed(2)}</td><td>{pick.bookmaker}</td><td>{dateTime(pick.capturedAt)}</td><td><span className={`status-badge ${pick.outcome.toLowerCase()}`}>{outcome(pick)}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="meta">ROI is one unit per settled selection at the locked recorded odds. Pending and void selections are excluded from hit rate and ROI. The rule threshold and market are fixed; review the date history prospectively without changing them.</p>
    </>}
  </section>;
}
