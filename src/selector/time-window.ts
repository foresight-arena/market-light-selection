import type { GammaEvent, GammaMarket } from "../gamma/types.js";

const HOUR_MS = 60 * 60 * 1000;

export const RESOLUTION_MIN_HOURS = 48;
export const RESOLUTION_MAX_HOURS = 72;

/**
 * Gamma `GET /events` query bounds (`end_date_min`, `end_date_max`), aligned with the 48–72h window:
 * now+48h and now+72h in ISO 8601.
 */
export function resolutionWindowEndDateIso(nowMs: number): {
  end_date_min: string;
  end_date_max: string;
} {
  const min = nowMs + RESOLUTION_MIN_HOURS * HOUR_MS;
  const max = nowMs + RESOLUTION_MAX_HOURS * HOUR_MS;
  return {
    end_date_min: new Date(min).toISOString(),
    end_date_max: new Date(max).toISOString(),
  };
}

/**
 * Resolution timestamp used for the 48–72h rule.
 *
 * Per-market `endDate`/`umaEndDate` are authoritative when present: if either is
 * already in the past, the market is treated as expired (return null) instead of
 * falling through to `event.endDate`. The fallback to `event.endDate` only fires
 * when the per-market timestamps are missing/unparseable — without this guard,
 * a daily-series event (e.g. "Will Trump insult someone on Apr 27?") would let
 * an already-resolved Apr 27 market inherit the event-level Apr 30 series end.
 */
export function resolutionEndMs(
  market: GammaMarket,
  event: GammaEvent,
  nowMs: number
): number | null {
  const m = market.endDate ? Date.parse(market.endDate) : NaN;
  if (Number.isFinite(m)) return m > nowMs ? m : null;

  const u = market.umaEndDate ? Date.parse(market.umaEndDate) : NaN;
  if (Number.isFinite(u)) return u > nowMs ? u : null;

  const e = event.endDate ? Date.parse(event.endDate) : NaN;
  return Number.isFinite(e) && e > nowMs ? e : null;
}

/**
 * Strict window: resolution end must lie **strictly between** now+48h and now+72h
 * (exclusive of the boundary instants).
 */
export function isInResolutionWindow(endMs: number, nowMs: number): boolean {
  const min = nowMs + RESOLUTION_MIN_HOURS * HOUR_MS;
  const max = nowMs + RESOLUTION_MAX_HOURS * HOUR_MS;
  return endMs > min && endMs < max;
}
