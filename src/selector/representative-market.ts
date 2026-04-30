import type { GammaEvent, GammaMarket } from "../gamma/types.js";
import { isBinaryYesNo, hasReasonableProbability, passesLowDisputeHeuristic } from "./candidate-filter.js";
import { isInResolutionWindow, resolutionEndMs } from "./time-window.js";

export type RepresentativeInnerStats = {
  inner_markets_skipped_outside_window: number;
  inner_markets_skipped_not_binary: number;
  inner_markets_skipped_extreme_probability: number;
  inner_markets_skipped_heuristic: number;
};

function emptyInnerStats(): RepresentativeInnerStats {
  return {
    inner_markets_skipped_outside_window: 0,
    inner_markets_skipped_not_binary: 0,
    inner_markets_skipped_extreme_probability: 0,
    inner_markets_skipped_heuristic: 0,
  };
}

function mergeInner(target: RepresentativeInnerStats, part: RepresentativeInnerStats): void {
  target.inner_markets_skipped_outside_window += part.inner_markets_skipped_outside_window;
  target.inner_markets_skipped_not_binary += part.inner_markets_skipped_not_binary;
  target.inner_markets_skipped_extreme_probability += part.inner_markets_skipped_extreme_probability;
  target.inner_markets_skipped_heuristic += part.inner_markets_skipped_heuristic;
}

function liquidityNum(m: GammaMarket): number {
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

function competitiveNum(m: GammaMarket, e: GammaEvent): number {
  if (typeof m.competitive === "number" && Number.isFinite(m.competitive)) return m.competitive;
  if (typeof e.competitive === "number" && Number.isFinite(e.competitive)) return e.competitive;
  return 0;
}

/**
 * Among markets on the event, pick exactly one representative:
 * binary Yes/No, passes light heuristics, resolution strictly in 48–72h.
 * Rank by: liquidity desc, competitive desc, deterministic market id.
 */
export function pickRepresentativeMarket(
  event: GammaEvent,
  nowMs: number,
  aggregateInner?: RepresentativeInnerStats
): { market: GammaMarket; resolutionEndMs: number } | null {
  const local = emptyInnerStats();
  const markets = Array.isArray(event.markets) ? event.markets : [];
  const viable: { market: GammaMarket; resolutionEndMs: number }[] = [];

  for (const market of markets) {
    const end = resolutionEndMs(market, event, nowMs);
    if (end === null || !isInResolutionWindow(end, nowMs)) {
      local.inner_markets_skipped_outside_window++;
      continue;
    }
    if (!isBinaryYesNo(market)) {
      local.inner_markets_skipped_not_binary++;
      continue;
    }
    if (!hasReasonableProbability(market)) {
      local.inner_markets_skipped_extreme_probability++;
      continue;
    }
    if (!passesLowDisputeHeuristic(market, event)) {
      local.inner_markets_skipped_heuristic++;
      continue;
    }
    viable.push({ market, resolutionEndMs: end });
  }

  if (aggregateInner) mergeInner(aggregateInner, local);
  if (viable.length === 0) return null;

  viable.sort((a, b) => {
    const ld = liquidityNum(b.market) - liquidityNum(a.market);
    if (ld !== 0) return ld;
    const cd = competitiveNum(b.market, event) - competitiveNum(a.market, event);
    if (cd !== 0) return cd;
    const sa = String(a.market.slug ?? a.market.id ?? "");
    const sb = String(b.market.slug ?? b.market.id ?? "");
    const s = sa.localeCompare(sb);
    if (s !== 0) return s;
    return String(a.market.id ?? "").localeCompare(String(b.market.id ?? ""));
  });

  return viable[0];
}
