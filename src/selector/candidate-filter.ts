import type { GammaEvent, GammaMarket } from "../gamma/types.js";

function parseOutcomes(raw: string | undefined): string[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return null;
    return v.map((x) => String(x));
  } catch {
    return null;
  }
}

/**
 * Prefer binary Yes/No CLOB-style markets; skip multi-outcome or messy strings.
 */
export function isBinaryYesNo(market: GammaMarket): boolean {
  const o = parseOutcomes(market.outcomes);
  if (!o || o.length !== 2) return false;
  const a = o[0]?.trim();
  const b = o[1]?.trim();
  return a === "Yes" && b === "No";
}

function parseOutcomePrices(raw: string | undefined): number[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return null;
    const nums = v.map((x) => parseFloat(String(x)));
    return nums.every((n) => Number.isFinite(n)) ? nums : null;
  } catch {
    return null;
  }
}

const MIN_YES_PRICE = 0.05;
const MAX_YES_PRICE = 0.95;

/**
 * Reject markets where the Yes outcome price is below 5% or above 95% —
 * these are effectively decided and not worth bidding on.
 */
export function hasReasonableProbability(market: GammaMarket): boolean {
  const prices = parseOutcomePrices(market.outcomePrices);
  if (!prices || prices.length < 1) return true; // no data → don't filter
  const yesPrice = prices[0];
  return yesPrice >= MIN_YES_PRICE && yesPrice <= MAX_YES_PRICE;
}

const TITLE_MIN = 12;
const TITLE_MAX = 320;

/**
 * Lightweight v1 heuristics only — not a full dispute engine.
 */
export function passesLowDisputeHeuristic(
  market: GammaMarket,
  event: GammaEvent
): boolean {
  const q = (market.question ?? "").trim();
  if (q.length < TITLE_MIN || q.length > TITLE_MAX) return false;
  const letters = q.replace(/[^a-zA-Z]/g, "").length;
  if (letters < 8) return false;
  if (/^\?+$/.test(q)) return false;
  if (/\?\?\?/.test(q)) return false;

  if (market.archived === true) return false;
  if (market.closed === true) return false;
  if (market.active === false) return false;
  if (event.archived === true) return false;
  if (event.closed === true) return false;
  if (event.active === false) return false;

  return true;
}
