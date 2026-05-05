import path from "node:path";

export function getDataDir(): string {
  const raw = process.env.LIGHTWEIGHT_SELECTOR_DATA_DIR;
  return raw ? path.resolve(raw) : path.resolve(process.cwd(), "data");
}

/** Gamma `/events` page size (limit). Env: `GAMMA_PAGE_SIZE` (default 100, max 500). */
export function getGammaPageSize(): number {
  const n = Number(process.env.GAMMA_PAGE_SIZE);
  if (Number.isFinite(n) && n >= 1 && n <= 500) return Math.floor(n);
  return 100;
}

/**
 * Max pages to fetch before giving up (safety cap). Scans until count is met, API short page, or this cap.
 * Env: `GAMMA_MAX_PAGES` or `LIGHTWEIGHT_SELECTOR_MAX_PAGES` (default 20, max 100).
 */
export function getMaxPages(): number {
  const raw =
    process.env.GAMMA_MAX_PAGES?.trim() ||
    process.env.LIGHTWEIGHT_SELECTOR_MAX_PAGES?.trim();
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1 && n <= 100) return Math.floor(n);
  return 20;
}

/**
 * Wall-clock budget for one selection run (fetch + select + fallback).
 * Checked between Gamma pages (not mid-request). Default allows ~20 pages with retries.
 * Env: `SELECTION_BUDGET_MS` (default `45000`, min `1000`, max `600000`).
 */
export function getSelectionBudgetMs(): number {
  const n = Number(process.env.SELECTION_BUDGET_MS);
  if (Number.isFinite(n) && n >= 1000 && n <= 600_000) return Math.floor(n);
  return 45_000;
}

/**
 * For sports markets exposing `gameStartTime`, the effective resolution time
 * used in the 48–72h window check is `max(endDate, gameStartTime + buffer)`.
 * Buffer covers game length + UMA propose/liveness. Default 6h (~3h game + ~3h UMA).
 * Env: `SPORTS_RESOLUTION_BUFFER_HOURS` (default `6`, min `0`, max `24`).
 */
export function getSportsResolutionBufferMs(): number {
  const n = Number(process.env.SPORTS_RESOLUTION_BUFFER_HOURS);
  const hours = Number.isFinite(n) && n >= 0 && n <= 24 ? n : 6;
  return hours * 60 * 60 * 1000;
}
