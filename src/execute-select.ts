import path from "node:path";
import { writeJsonFile } from "./util/file.js";
import { systemClock } from "./util/clock.js";
import { getGammaPageSize, getMaxPages, getSelectionBudgetMs } from "./config.js";
import { selectMarkets } from "./selector/select-markets.js";
import {
  appendServedEvents,
  loadServedEventsWithPrune,
  servedStableIdSet,
} from "./store/served-events.js";
import type { SelectionResponse } from "./response/format.js";
import type { SelectionDiagnostics } from "./response/format.js";
import type { ServedEventRecord } from "./store/served-events.js";

export type ExecuteSelectResult = {
  response: SelectionResponse;
  diagnostics: SelectionDiagnostics;
  newServedRecords: ServedEventRecord[];
};

export type ExecuteSelectOptions = {
  requestedCount: number;
  dataDir: string;
  maxPages?: number;
  pageSize?: number;
  /** When true, do not append served events or write debug file. Read-only. */
  dryRun?: boolean;
};

export async function executeSelect(
  opts: ExecuteSelectOptions
): Promise<ExecuteSelectResult> {
  const { requestedCount, dataDir, maxPages, pageSize, dryRun = false } = opts;

  const { records: servedRecords } = await loadServedEventsWithPrune(
    dataDir,
    systemClock.nowMs()
  );
  const servedStableIds = servedStableIdSet(servedRecords);

  const { response, diagnostics, newServedRecords } = await selectMarkets({
    requestedCount,
    maxPages: maxPages ?? getMaxPages(),
    pageSize: pageSize ?? getGammaPageSize(),
    selectionBudgetMs: getSelectionBudgetMs(),
    servedStableIds,
    clock: systemClock,
  });

  if (!dryRun) {
    await appendServedEvents(dataDir, newServedRecords);

    const debugPath = path.join(dataDir, "last-run-debug.json");
    await writeJsonFile(debugPath, {
      generated_at: response.generated_at,
      diagnostics,
      new_served_records: newServedRecords,
    });
  }

  return { response, diagnostics, newServedRecords };
}
