import { fetchEventsPage, defaultEventsQuery, type EventsQueryParams } from "../gamma/client.js";
import type { GammaEvent } from "../gamma/types.js";
import type { Clock } from "../util/clock.js";
import { logInfo, logWarn } from "../util/log.js";
import { deriveCategory, type SelectorCategory } from "./category.js";
import type { EventCandidate } from "./event-candidate.js";
import {
  pickRepresentativeMarket,
  type RepresentativeInnerStats,
} from "./representative-market.js";
import { rankEventCandidates } from "./ranking.js";
import { resolutionWindowEndDateIso } from "./time-window.js";
import { stableEventId } from "./stable-event-id.js";
import type { SelectionDiagnostics, SelectionResponse } from "../response/format.js";
import type { ServedEventRecord } from "../store/served-events.js";

export type { EventCandidate } from "./event-candidate.js";

export type SelectMarketsOptions = {
  requestedCount: number;
  maxPages: number;
  /** Gamma `/events` limit (page size). */
  pageSize: number;
  /** Wall-clock budget for the whole selection; checked between page fetches. */
  selectionBudgetMs: number;
  /**
   * Buffer added to `gameStartTime` when computing a sports market's effective
   * resolution time (max(endDate, gameStartTime + buffer)). 0 disables the
   * sports adjustment entirely.
   */
  sportsGameBufferMs?: number;
  servedStableIds: Set<string>;
  clock: Clock;
  gammaQuery?: Partial<EventsQueryParams>;
};

function eventEligible(event: GammaEvent): boolean {
  if (event.archived === true) return false;
  if (event.closed === true) return false;
  if (event.active === false) return false;
  return true;
}

function strictSelectByCategory(
  ranked: EventCandidate[],
  requested: number
): { picked: EventCandidate[]; skippedCategoryDuplicate: number } {
  const usedCategories = new Set<SelectorCategory>();
  const picked: EventCandidate[] = [];
  let skippedCategoryDuplicate = 0;

  for (const c of ranked) {
    if (picked.length >= requested) break;
    if (usedCategories.has(c.category)) {
      skippedCategoryDuplicate++;
      continue;
    }
    picked.push(c);
    usedCategories.add(c.category);
  }

  return { picked, skippedCategoryDuplicate };
}

/**
 * After pages are exhausted: allow a second (or more) event per category,
 * still at most one market per event (one row per stable_event_id).
 */
function relaxCategorySelect(
  ranked: EventCandidate[],
  requested: number,
  partial: EventCandidate[]
): EventCandidate[] {
  const picked = [...partial];
  const seen = new Set(picked.map((c) => c.stableEventId));
  for (const c of ranked) {
    if (picked.length >= requested) break;
    if (seen.has(c.stableEventId)) continue;
    picked.push(c);
    seen.add(c.stableEventId);
  }
  return picked;
}

function uniqueCategoryCount(rows: EventCandidate[]): number {
  return new Set(rows.map((r) => r.category)).size;
}

/**
 * Event-first pipeline: one representative market per event, greedy selection over events,
 * category-unique strict pass, category relaxation only after pages are exhausted.
 *
 * Search policy: keep fetching Gamma pages until **strict fill** (early exit), **max pages**,
 * **API short page**, or **selection budget** (between pages). Fallback runs only after
 * fetch phase ends for that request — never before pages are exhausted for that terminator.
 */
export async function selectMarkets(
  opts: SelectMarketsOptions
): Promise<{
  response: SelectionResponse;
  diagnostics: SelectionDiagnostics;
  newServedRecords: ServedEventRecord[];
}> {
  const now = opts.clock.nowMs();
  const selectionDeadlineMs = now + opts.selectionBudgetMs;
  const useEndDateFilter = process.env.GAMMA_DISABLE_END_DATE_FILTER !== "1";
  const windowIso = useEndDateFilter ? resolutionWindowEndDateIso(now) : {};
  const sourceQuery: EventsQueryParams = {
    ...defaultEventsQuery(),
    limit: opts.pageSize,
    ...windowIso,
    ...opts.gammaQuery,
  };

  const innerTotals: RepresentativeInnerStats = {
    inner_markets_skipped_outside_window: 0,
    inner_markets_skipped_not_binary: 0,
    inner_markets_skipped_extreme_probability: 0,
    inner_markets_skipped_heuristic: 0,
  };

  let candidateEventsConsidered = 0;
  let candidateEventsSkippedServed = 0;
  let candidateEventsSkippedInactive = 0;
  let candidateEventsSkippedNoValidMarket = 0;
  let candidateEventsSkippedDuplicateEvent = 0;

  const candidateMap = new Map<string, EventCandidate>();

  let pagesFetched = 0;
  let totalEventsFetched = 0;
  let orderEffective: string | null = null;

  let picked: EventCandidate[] = [];
  let skippedCategoryDuplicateStrict = 0;
  let fallbackTriggered = false;
  let fallbackReason: string | null = null;
  let filled = false;
  let exitedWithStrictFull = false;
  let stoppedDueToApiShort = false;
  let stoppedDueToBudget = false;

  const ingestPage = (events: GammaEvent[], pageIndex: number): void => {
    events.forEach((event, eventIndex) => {
      candidateEventsConsidered++;
      const sid = stableEventId(event);

      if (candidateMap.has(sid)) {
        candidateEventsSkippedDuplicateEvent++;
        return;
      }
      if (opts.servedStableIds.has(sid)) {
        candidateEventsSkippedServed++;
        return;
      }
      if (!eventEligible(event)) {
        candidateEventsSkippedInactive++;
        return;
      }

      const rep = pickRepresentativeMarket(event, now, innerTotals, opts.sportsGameBufferMs ?? 0);
      if (!rep) {
        candidateEventsSkippedNoValidMarket++;
        return;
      }

      const category = deriveCategory(event, rep.market);
      candidateMap.set(sid, {
        pageIndex,
        eventIndex,
        event,
        market: rep.market,
        stableEventId: sid,
        category,
        resolutionEndMs: rep.resolutionEndMs,
      });
    });
  };

  const runSelection = (
    ranked: EventCandidate[],
    exhaustedReason: "api_short" | "max_pages" | "selection_budget"
  ): void => {
    if (ranked.length === 0) {
      picked = [];
      skippedCategoryDuplicateStrict = 0;
      fallbackTriggered = false;
      fallbackReason = null;
      filled = true;
      return;
    }
    const strict = strictSelectByCategory(ranked, opts.requestedCount);
    skippedCategoryDuplicateStrict = strict.skippedCategoryDuplicate;
    if (strict.picked.length >= opts.requestedCount) {
      picked = strict.picked;
      fallbackTriggered = false;
      fallbackReason = null;
      filled = true;
      return;
    }
    picked = relaxCategorySelect(ranked, opts.requestedCount, strict.picked);
    fallbackTriggered = true;
    fallbackReason =
      exhaustedReason === "api_short"
        ? "category_relaxation_after_api_short_page"
        : exhaustedReason === "selection_budget"
          ? "category_relaxation_after_selection_budget"
          : "category_relaxation_after_max_pages_exhausted";
    filled = true;
    if (picked.length < opts.requestedCount) {
      logWarn(
        "Category relaxation after page exhaustion still short of requested count",
        {
          requested: opts.requestedCount,
          selected: picked.length,
          reason: fallbackReason,
        }
      );
    } else {
      logWarn(
        "Category uniqueness relaxed after exhausting event pages (still one market per event; served events excluded)",
        {
          requested: opts.requestedCount,
          selected: picked.length,
          unique_categories: uniqueCategoryCount(picked),
          reason: fallbackReason,
        }
      );
    }
  };

  for (let page = 0; page < opts.maxPages; page++) {
    if (opts.clock.nowMs() >= selectionDeadlineMs) {
      stoppedDueToBudget = true;
      break;
    }

    const offset = page * sourceQuery.limit;
    const queryForPage: EventsQueryParams = {
      ...sourceQuery,
      ...opts.gammaQuery,
      order: orderEffective ?? sourceQuery.order,
    };
    const { events, effectiveOrder } = await fetchEventsPage(offset, {
      query: queryForPage,
    });
    orderEffective = effectiveOrder;
    pagesFetched++;
    totalEventsFetched += events.length;

    ingestPage(events, page);

    const ranked = rankEventCandidates([...candidateMap.values()]);
    const strict = strictSelectByCategory(ranked, opts.requestedCount);

    // Early exit: strict pass fills count without category relaxation (optimization).
    if (strict.picked.length >= opts.requestedCount) {
      picked = strict.picked;
      skippedCategoryDuplicateStrict = strict.skippedCategoryDuplicate;
      fallbackTriggered = false;
      fallbackReason = null;
      filled = true;
      exitedWithStrictFull = true;
      break;
    }

    if (events.length < sourceQuery.limit) {
      stoppedDueToApiShort = true;
      runSelection(ranked, "api_short");
      break;
    }
  }

  if (!filled && pagesFetched > 0) {
    const ranked = rankEventCandidates([...candidateMap.values()]);
    if (stoppedDueToBudget) {
      runSelection(ranked, "selection_budget");
    } else {
      runSelection(ranked, "max_pages");
    }
  }

  if (!filled && pagesFetched === 0 && stoppedDueToBudget) {
    runSelection([], "selection_budget");
  }

  const representativeMarketsBuilt = candidateMap.size;
  const candidateEventsInWindow = representativeMarketsBuilt;

  const searchExhausted = !exitedWithStrictFull;
  const underfilledReason:
    | "search_exhausted"
    | "no_more_results"
    | "selection_budget_exhausted"
    | null =
    picked.length >= opts.requestedCount
      ? null
      : stoppedDueToBudget
        ? "selection_budget_exhausted"
        : stoppedDueToApiShort
          ? "no_more_results"
          : "search_exhausted";

  const generatedAt = new Date(opts.clock.nowMs()).toISOString();
  const newServedRecords: ServedEventRecord[] = picked.map((c) => {
    const mid = String(c.market.id ?? "");
    const endIso = new Date(c.resolutionEndMs).toISOString();
    return {
      stable_event_id: c.stableEventId,
      event_id: String(c.event.id ?? ""),
      event_slug: c.event.slug ?? "",
      representative_market_id: mid,
      representative_market_slug: c.market.slug ?? "",
      market_id: mid,
      end_time: endIso,
      served_at: generatedAt,
    };
  });

  const diagnostics: SelectionDiagnostics = {
    requested_count: opts.requestedCount,
    gamma_page_size: sourceQuery.limit,
    max_pages_configured: opts.maxPages,
    pages_fetched: pagesFetched,
    total_events_fetched: totalEventsFetched,
    search_exhausted: searchExhausted,
    underfilled_reason: underfilledReason,
    selection_budget_ms: opts.selectionBudgetMs,
    stopped_due_to_budget: stoppedDueToBudget,
    candidate_events_considered: candidateEventsConsidered,
    candidate_events_in_window: candidateEventsInWindow,
    candidate_events_skipped_served: candidateEventsSkippedServed,
    candidate_events_skipped_inactive: candidateEventsSkippedInactive,
    candidate_events_skipped_no_valid_market: candidateEventsSkippedNoValidMarket,
    candidate_events_skipped_duplicate_event: candidateEventsSkippedDuplicateEvent,
    candidate_events_skipped_category_duplicate: skippedCategoryDuplicateStrict,
    representative_markets_built: representativeMarketsBuilt,
    inner_markets_skipped_outside_window: innerTotals.inner_markets_skipped_outside_window,
    inner_markets_skipped_not_binary: innerTotals.inner_markets_skipped_not_binary,
    inner_markets_skipped_extreme_probability: innerTotals.inner_markets_skipped_extreme_probability,
    inner_markets_skipped_heuristic: innerTotals.inner_markets_skipped_heuristic,
    selected_count: picked.length,
    selected_unique_event_count: picked.length,
    selected_unique_category_count: uniqueCategoryCount(picked),
    fallback_triggered: fallbackTriggered,
    fallback_reason: fallbackReason,
  };

  logInfo("selection diagnostics", diagnostics as unknown as Record<string, unknown>);

  const response: SelectionResponse = {
    generated_at: generatedAt,
    requested_count: opts.requestedCount,
    selected_count: picked.length,
    pages_fetched: pagesFetched,
    gamma_page_size: sourceQuery.limit,
    max_pages_configured: opts.maxPages,
    search_exhausted: searchExhausted,
    underfilled_reason: underfilledReason,
    candidate_events_in_window: candidateEventsInWindow,
    representative_markets_built: representativeMarketsBuilt,
    selection_budget_ms: opts.selectionBudgetMs,
    stopped_due_to_budget: stoppedDueToBudget,
    fallback_triggered: fallbackTriggered,
    fallback_reason: fallbackReason,
    source_query: {
      endpoint: "GET /events",
      active: sourceQuery.active,
      closed: sourceQuery.closed,
      limit: sourceQuery.limit,
      order_requested: sourceQuery.order,
      order_effective: orderEffective ?? sourceQuery.order,
      ascending: sourceQuery.ascending,
      end_date_min: sourceQuery.end_date_min ?? null,
      end_date_max: sourceQuery.end_date_max ?? null,
      note:
        "end_date_min/max = now+48h / now+72h (ISO) unless GAMMA_DISABLE_END_DATE_FILTER=1. order=volume24hr (camelCase); snake_case volume_24hr may 200 without real volume sort. Client still enforces strict 48–72h per market.",
    },
    markets: picked.map((c) => {
      const eventSlug = c.event.slug ?? "";
      const polymarketUrl = eventSlug
        ? `https://polymarket.com/event/${eventSlug}`
        : "";
      return {
        stable_event_id: c.stableEventId,
        title: (c.market.question ?? c.event.title ?? "").trim(),
        slug: c.market.slug ?? c.event.slug ?? "",
        event_slug: eventSlug,
        polymarket_url: polymarketUrl,
        event_id: String(c.event.id ?? ""),
        market_id: String(c.market.id ?? ""),
        condition_id: c.market.conditionId ?? null,
        category: c.category,
        end_date: new Date(c.resolutionEndMs).toISOString(),
        resolution_end_ms: c.resolutionEndMs,
        event_volume_24hr: c.event.volume24hr ?? null,
        market_liquidity:
          typeof c.market.liquidityNum === "number"
            ? c.market.liquidityNum
            : typeof c.market.liquidity === "number"
              ? c.market.liquidity
              : null,
        competitive:
          typeof c.market.competitive === "number"
            ? c.market.competitive
            : c.event.competitive ?? null,
      };
    }),
    diagnostics,
  };

  return { response, diagnostics, newServedRecords };
}
