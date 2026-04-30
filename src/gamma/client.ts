import type { GammaEvent } from "./types.js";
import { fetchWithRetry, parseRetryEnv, type RetryOptions } from "../util/retry.js";
import { logError, logInfo, logWarn } from "../util/log.js";

const DEFAULT_BASE = "https://gamma-api.polymarket.com";

/**
 * Live Gamma sorts by camelCase `volume24hr`. The snake_case `volume_24hr` form
 * from older public docs returns HTTP 200 but silently falls back to default
 * (creation-order) ranking, which buries high-volume short-horizon markets.
 * Fallback kept only for forward-compat if Gamma ever flips which form it accepts.
 */
const DEFAULT_ORDER_REQUESTED = "volume24hr";
const DEFAULT_ORDER_FALLBACK = "volume_24hr";

export type EventsQueryParams = {
  active: boolean;
  closed: boolean;
  limit: number;
  offset: number;
  order: string;
  ascending: boolean;
  /** When set, Gamma filters events by end time (ISO 8601). */
  end_date_min?: string;
  end_date_max?: string;
};

export function defaultEventsQuery(): EventsQueryParams {
  return {
    active: true,
    closed: false,
    limit: 100,
    offset: 0,
    order: process.env.GAMMA_ORDER?.trim() || DEFAULT_ORDER_REQUESTED,
    ascending: false,
  };
}

function buildEventsUrl(base: string, q: EventsQueryParams): string {
  const u = new URL("/events", base);
  u.searchParams.set("active", String(q.active));
  u.searchParams.set("closed", String(q.closed));
  u.searchParams.set("limit", String(q.limit));
  u.searchParams.set("offset", String(q.offset));
  u.searchParams.set("order", q.order);
  u.searchParams.set("ascending", String(q.ascending));
  if (q.end_date_min) {
    u.searchParams.set("end_date_min", q.end_date_min);
  }
  if (q.end_date_max) {
    u.searchParams.set("end_date_max", q.end_date_max);
  }
  return u.toString();
}

export type FetchEventsPageResult = {
  events: GammaEvent[];
  /** Order string that Gamma accepted for this request. */
  effectiveOrder: string;
};

async function fetchOnce(
  base: string,
  q: EventsQueryParams,
  retryOpts: Partial<RetryOptions>
): Promise<Response> {
  const url = buildEventsUrl(base, q);
  return fetchWithRetry(
    url,
    { headers: { Accept: "application/json" } },
    retryOpts
  );
}

/**
 * Fetches one page of /events. Tries the requested `order` first; on 422 (invalid order field),
 * retries once with `GAMMA_ORDER_FALLBACK` (default `volume24hr`) so the service stays usable.
 */
export async function fetchEventsPage(
  offset: number,
  opts: { baseUrl?: string; query?: Partial<EventsQueryParams>; retry?: Partial<RetryOptions> } = {}
): Promise<FetchEventsPageResult> {
  const base = opts.baseUrl ?? process.env.GAMMA_API_BASE ?? DEFAULT_BASE;
  const q = { ...defaultEventsQuery(), ...opts.query, offset };
  const retryOpts: Partial<RetryOptions> = {
    label: "gamma-events",
    ...parseRetryEnv(),
    ...opts.retry,
  };

  let res = await fetchOnce(base, q, retryOpts);
  let effectiveOrder = q.order;

  if (!res.ok && res.status === 422) {
    const errBody = await res.text().catch(() => "");
    const fallback =
      process.env.GAMMA_ORDER_FALLBACK?.trim() || DEFAULT_ORDER_FALLBACK;
    if (q.order !== fallback) {
      logWarn("Gamma rejected /events order param; retrying with fallback order", {
        requested_order: q.order,
        fallback_order: fallback,
        status: res.status,
        body: errBody.slice(0, 200),
      });
      const q2 = { ...q, order: fallback };
      res = await fetchOnce(base, q2, retryOpts);
      effectiveOrder = fallback;
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logError(`Gamma /events failed: ${res.status}`, body.slice(0, 500));
    throw new Error(`Gamma /events HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    logError("Gamma /events: expected array", JSON.stringify(data).slice(0, 300));
    throw new Error("Gamma /events: response is not a JSON array");
  }

  logInfo("Gamma /events page", {
    offset: q.offset,
    count: data.length,
    effective_order: effectiveOrder,
  });
  return { events: data as GammaEvent[], effectiveOrder };
}
