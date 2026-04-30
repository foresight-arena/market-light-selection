import type { GammaMarket } from "../gamma/types.js";
import type { EventCandidate } from "./event-candidate.js";

function numLiquidity(m: GammaMarket): number {
  if (typeof m.liquidityNum === "number" && Number.isFinite(m.liquidityNum)) {
    return m.liquidityNum;
  }
  const liq = m.liquidity;
  if (typeof liq === "number" && Number.isFinite(liq)) return liq;
  if (typeof liq === "string") {
    const n = parseFloat(liq);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function numVolume(m: GammaMarket): number {
  if (typeof m.volumeNum === "number" && Number.isFinite(m.volumeNum)) {
    return m.volumeNum;
  }
  const v = m.volume;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function numCompetitive(c: EventCandidate): number {
  const m = c.market.competitive;
  if (typeof m === "number" && Number.isFinite(m)) return m;
  const ev = c.event.competitive;
  if (typeof ev === "number" && Number.isFinite(ev)) return ev;
  return 0;
}

/**
 * Preserve Gamma /events order (page, event index), then tie-break on representative market.
 */
export function rankEventCandidates(candidates: EventCandidate[]): EventCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
    if (a.eventIndex !== b.eventIndex) return a.eventIndex - b.eventIndex;

    const ld = numLiquidity(b.market) - numLiquidity(a.market);
    if (ld !== 0) return ld;

    const vd = numVolume(b.market) - numVolume(a.market);
    if (vd !== 0) return vd;

    const cd = numCompetitive(b) - numCompetitive(a);
    if (cd !== 0) return cd;

    return a.stableEventId.localeCompare(b.stableEventId);
  });
}
