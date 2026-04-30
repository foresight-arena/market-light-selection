import path from "node:path";
import { readJsonFile, writeJsonFile, ensureDir } from "../util/file.js";
import { logError, logInfo, logWarn } from "../util/log.js";

/** 24h after resolution end before a served row may be pruned. */
export const SERVED_PRUNE_BUFFER_MS = 24 * 60 * 60 * 1000;

/**
 * One row per served event per selection response.
 * Legacy files may use `market_id` / `market_slug` instead of representative_*.
 * New rows include `end_time` (ISO) for automatic pruning.
 */
export type ServedEventRecord = {
  stable_event_id: string;
  event_id: string;
  event_slug: string;
  representative_market_id: string;
  representative_market_slug: string;
  /** Same as `representative_market_id` on new writes (explicit field for operators). */
  market_id?: string;
  served_at: string;
  /** Representative resolution end (ISO 8601). Required for pruning on new writes. */
  end_time?: string;
  /** @deprecated older deployments */
  market_slug?: string;
};

export function servedEventsPath(dataDir: string): string {
  return path.join(dataDir, "served-events.json");
}

export async function readServedEvents(dataDir: string): Promise<ServedEventRecord[]> {
  const p = servedEventsPath(dataDir);
  try {
    const data = await readJsonFile<unknown>(p);
    if (data === null) return [];
    if (!Array.isArray(data)) return [];
    return data as ServedEventRecord[];
  } catch (e) {
    logError("readServedEvents failed", e);
    throw e;
  }
}

/**
 * Loads served events and removes rows whose `end_time` + 24h is before `nowMs`.
 * Entries without a valid `end_time` are kept (not pruned); a warning is logged if any.
 * Persists the cleaned list only when at least one row was removed.
 */
export async function loadServedEventsWithPrune(
  dataDir: string,
  nowMs: number
): Promise<{ records: ServedEventRecord[]; before: number; removed: number; after: number }> {
  logInfo("served_events_prune_start");
  const records = await readServedEvents(dataDir);
  const before = records.length;
  let missingOrInvalidEnd = 0;
  const kept: ServedEventRecord[] = [];

  for (const r of records) {
    if (!r.end_time || typeof r.end_time !== "string") {
      missingOrInvalidEnd++;
      kept.push(r);
      continue;
    }
    const endMs = Date.parse(r.end_time);
    if (!Number.isFinite(endMs)) {
      missingOrInvalidEnd++;
      logWarn("served_events_prune_invalid_end_time", {
        stable_event_id: r.stable_event_id,
        end_time: r.end_time,
      });
      kept.push(r);
      continue;
    }
    if (nowMs > endMs + SERVED_PRUNE_BUFFER_MS) {
      continue;
    }
    kept.push(r);
  }

  if (missingOrInvalidEnd > 0) {
    logWarn("served_events_prune_missing_end_time", { entries: missingOrInvalidEnd });
  }

  const after = kept.length;
  const removed = before - after;
  if (removed > 0) {
    await ensureDir(dataDir);
    await writeJsonFile(servedEventsPath(dataDir), kept);
  }

  logInfo("served_events_prune_result", { before, removed, after });
  return { records: kept, before, removed, after };
}

export function servedStableIdSet(records: ServedEventRecord[]): Set<string> {
  return new Set(records.map((r) => r.stable_event_id));
}

export async function appendServedEvents(
  dataDir: string,
  newRecords: ServedEventRecord[]
): Promise<void> {
  if (newRecords.length === 0) return;
  await ensureDir(dataDir);
  const existing = await readServedEvents(dataDir);
  const next = [...existing, ...newRecords];
  await writeJsonFile(servedEventsPath(dataDir), next);
}

/**
 * Overwrites `served-events.json` with `[]`. Creates the file (and dir) if missing.
 * @returns number of records that were present before clear
 */
export async function clearServedEventsHistory(dataDir: string): Promise<number> {
  const existing = await readServedEvents(dataDir);
  const count = existing.length;
  await ensureDir(dataDir);
  await writeJsonFile(servedEventsPath(dataDir), []);
  return count;
}
