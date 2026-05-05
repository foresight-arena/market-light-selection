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
 * Parses Gamma's `gameStartTime` ("YYYY-MM-DD HH:MM:SS+00", non-standard ISO).
 * Returns null on missing/unparseable input.
 */
export function parseGameStartTimeMs(raw: string | undefined | null): number | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const normalized = raw.trim().replace(" ", "T").replace(/\+00$/, "+00:00");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
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
 *
 * Sports adjustment: when `gameStartTime` is set, the effective resolution time is
 * `max(endDate, gameStartTime + sportsGameBufferMs)`. Many sports markets (NBA,
 * late kickoffs) list `endDate` at local end-of-day, hours *before* the actual
 * game tip-off; without this the selector picks markets that cannot resolve
 * before the round's `revealDeadline`. The check is a no-op for non-sports
 * markets that also expose `gameStartTime` as a window-start (e.g. month-long
 * crude-oil bands), since their `endDate` is far past `gameStartTime + buffer`.
 */
export function resolutionEndMs(
  market: GammaMarket,
  event: GammaEvent,
  nowMs: number,
  sportsGameBufferMs = 0
): number | null {
  let end: number | null = null;
  const m = market.endDate ? Date.parse(market.endDate) : NaN;
  if (Number.isFinite(m)) {
    end = m > nowMs ? m : null;
  } else {
    const u = market.umaEndDate ? Date.parse(market.umaEndDate) : NaN;
    if (Number.isFinite(u)) {
      end = u > nowMs ? u : null;
    } else {
      const e = event.endDate ? Date.parse(event.endDate) : NaN;
      if (Number.isFinite(e) && e > nowMs) end = e;
    }
  }
  if (end === null) return null;

  const gst = parseGameStartTimeMs(market.gameStartTime);
  if (gst !== null) {
    const sportsResolution = gst + sportsGameBufferMs;
    if (sportsResolution > end) end = sportsResolution;
  }
  return end;
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
