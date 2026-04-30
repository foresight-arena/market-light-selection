import type { SelectorCategory } from "../selector/category.js";

export type SelectionMarket = {
  stable_event_id: string;
  title: string;
  slug: string;
  event_slug: string;
  polymarket_url: string;
  event_id: string;
  /** Representative market id (one per event). */
  market_id: string;
  condition_id: string | null;
  category: SelectorCategory;
  end_date: string;
  resolution_end_ms: number;
  event_volume_24hr: number | null;
  market_liquidity: number | null;
  competitive: number | null;
};

export type SelectionDiagnostics = {
  requested_count: number;
  /** Configured Gamma `/events` limit per page. */
  gamma_page_size: number;
  /** Configured max pages cap for this run. */
  max_pages_configured: number;
  pages_fetched: number;
  total_events_fetched: number;
  /**
   * True when scanning stopped because the API returned a short page or the max-pages cap was hit,
   * without leaving early only because strict category-unique selection already met `requested_count`.
   */
  search_exhausted: boolean;
  /**
   * When `selected_count < requested_count`: why we stopped filling.
   * `no_more_results` — Gamma returned fewer than `limit` rows (end of catalog for this query).
   * `search_exhausted` — hit `max_pages_configured` on a full last page before filling.
   * `selection_budget_exhausted` — `SELECTION_BUDGET_MS` elapsed before filling (checked between pages).
   */
  underfilled_reason:
    | "search_exhausted"
    | "no_more_results"
    | "selection_budget_exhausted"
    | null;

  /** Configured wall-clock budget for this selection run (ms). */
  selection_budget_ms: number;
  /** True if scanning stopped because the budget was reached (between page fetches). */
  stopped_due_to_budget: boolean;

  candidate_events_considered: number;
  candidate_events_in_window: number;
  candidate_events_skipped_served: number;
  candidate_events_skipped_inactive: number;
  candidate_events_skipped_no_valid_market: number;
  candidate_events_skipped_duplicate_event: number;
  candidate_events_skipped_category_duplicate: number;
  representative_markets_built: number;

  inner_markets_skipped_outside_window: number;
  inner_markets_skipped_not_binary: number;
  inner_markets_skipped_extreme_probability: number;
  inner_markets_skipped_heuristic: number;

  selected_count: number;
  selected_unique_event_count: number;
  selected_unique_category_count: number;

  fallback_triggered: boolean;
  /** Set when category uniqueness was relaxed after exhausting pages. */
  fallback_reason: string | null;
};

export type SelectionResponse = {
  generated_at: string;
  requested_count: number;
  selected_count: number;
  pages_fetched: number;
  gamma_page_size: number;
  max_pages_configured: number;
  search_exhausted: boolean;
  underfilled_reason:
    | "search_exhausted"
    | "no_more_results"
    | "selection_budget_exhausted"
    | null;
  /** Same as `diagnostics.candidate_events_in_window` (in-window representative events this run). */
  candidate_events_in_window: number;
  /** Same as `diagnostics.representative_markets_built`. */
  representative_markets_built: number;
  selection_budget_ms: number;
  stopped_due_to_budget: boolean;
  fallback_triggered: boolean;
  fallback_reason: string | null;
  source_query: {
    endpoint: string;
    active: boolean;
    closed: boolean;
    limit: number;
    order_requested: string;
    order_effective: string;
    ascending: boolean;
    end_date_min: string | null;
    end_date_max: string | null;
    note?: string;
  };
  markets: SelectionMarket[];
  diagnostics: SelectionDiagnostics;
};
