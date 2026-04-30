# Methodology — lightweight Polymarket selector

## Non-goals

- **Not** a claim of exact parity with Polymarket’s **internal** homepage or “Trending” ranking.
- **Not** a full dispute or manipulation engine — only **lightweight v1 heuristics** (binary Yes/No, clear end time, active/not archived, sane titles).

## Discovery source (public popularity proxy)

- **Endpoint**: Gamma `GET /events`
- **Documented starting point**: `active=true`, `closed=false`, `order=volume_24hr`, `ascending=false`, `limit=100`, `offset` per page  
- **Live API behavior**: Polymarket’s server may reject `order=volume_24hr` with **422**. This service **requests** the documented value first, then **falls back** once per page to `GAMMA_ORDER_FALLBACK` (default `volume24hr`) so operations stay stable. Responses record **`order_requested`** vs **`order_effective`**.

## Why deep scanning is required

High-volume `/events` pages are dominated by markets **outside** the strict **48–72h** resolution band. In practice, only a **small fraction** of fetched events yield a valid representative (binary Yes/No, heuristics, window). Measurements (see `docs/reviews/lightweight-selector-deep-scan-test.md`) show that **the first few hundred events** may contain **too few distinct categories** for a strict category-unique set of 5–10 picks. **Iterating deeper into Gamma pages** grows the pool of in-window representatives and makes reaching `count` far more reliable before any fallback.

**Default cap:** `GAMMA_MAX_PAGES=20` (configurable). Scanning stops earlier if the **strict** pass already fills `count` (performance).

## Why category relaxation is needed

Even after many pages, the **strict** rule — **at most one event per derived category** — may cap the selection below `count` because **too few categories** appear among in-window events (e.g. many reps are “crypto” or “sports”). **Relaxation** (after the fetch phase ends) allows **a second event from an already-used category**, still **one market per event** and **never** served events. Deep-scan evidence: **strict 10** was often impossible in the top ~2000 events while **relaxed 10** was achievable.

## Why the 48–72h window reduces supply

The window is **intentionally narrow** (resolution end **strictly between** now+48h and now+72h). Most trending events resolve sooner, later, or are ambiguous — they are excluded. That **shrinks the universe** and is why the selector must scan **many Gamma rows** to find enough qualifying **events**, not just “top 100.”

## Latency vs diversity (tradeoffs)

| Knob | Effect |
|------|--------|
| **`GAMMA_MAX_PAGES`** ↑ | More diversity / fill chance; more sequential Gamma calls → higher tail latency. |
| **`GAMMA_PAGE_SIZE`** ↑ | Fewer HTTP round-trips per depth; larger payloads. |
| **`SELECTION_BUDGET_MS`** ↓ | Caps wall-clock time (checked **between** pages); may underfill if set too low for your `GAMMA_MAX_PAGES`. Default **45s** fits ~20 pages with retries. |
| **`GAMMA_TIMEOUT_MS`** | Per HTTP attempt; interacts with retries. |

**Aggressive low-latency mode** (e.g. sub‑3s SLO): use a **small** `GAMMA_MAX_PAGES` (often **≤3**) **and** a matching `SELECTION_BUDGET_MS`. The default **20 pages + 45s budget** targets **reliability** over minimal latency.

## Final search policy (locked)

**Fetch phase** — repeat until any terminator:

1. **Strict success:** greedy **category-unique** selection over the accumulated pool already reaches **`requested_count`** (one representative market per event, 48–72h, unserved only) → **stop fetching** (early exit).
2. **Max pages:** `pages_fetched >= GAMMA_MAX_PAGES` on a full last page → end fetch phase → run final selection (strict then relax if needed).
3. **Gamma short page:** fewer than `limit` rows → no more results for this query → end fetch phase → final selection.
4. **Selection budget:** wall clock **`SELECTION_BUDGET_MS`** elapsed (**checked before each new page fetch**) → end fetch phase → final selection.

**Selection phase** (after fetch phase ends for this request):

1. **Strict:** same rules as above (48–72h, one market per event, category uniqueness).
2. **Fallback:** if strict is short, **relax categories** — additional events from categories already used — **only after** fetch phase exhaustion (terminators 2–4 or strict early exit does not use fallback). **Never** multiple markets from one event; **never** served events.

## Event-first selection (core)

Selection is **event-first**, not market-first:

1. **Pages**: fetch `/events` with `GAMMA_PAGE_SIZE` and up to **`GAMMA_MAX_PAGES`** (default 20).
2. **Per event** (first occurrence of each `stable_event_id` wins if the API repeats an event):
   - Skip if already **served** (`served-events.json`).
   - Skip if the event is not **active / open** (not archived, not closed, `active`).
   - **Representative market**: among child markets, keep only those that are binary Yes/No, pass light heuristics, and have resolution time **strictly between** 48h and 72h from now. Pick **exactly one** market per event by: liquidity → competitive → deterministic slug/id.
   - If no market qualifies, the whole event is skipped.
3. **Rank** surviving **events** (each carrying its representative) by `(pageIndex, eventIndex)`, then representative liquidity / volume / competitive / `stable_event_id`.
4. **Strict pass**: greedy walk — **at most one event per category** (hence at most one returned market per event).
5. **Early exit (optimization):** if strict already fills `requested_count`, **stop scanning** — no category relaxation needed.
6. **Fallback** (only after fetch phase ended without strict early exit): allow **multiple events from the same category** if needed to approach `count`. **Never** a second market from the same event. **Never** a previously served event. `fallback_reason` / `fallback_triggered` describe the path.

## Popularity ranking (deterministic)

1. **Primary**: Gamma’s list order for the effective `order` parameter.
2. **Among events**: `(pageIndex, eventIndex)`.
3. **Tie-breaks on the representative market**: liquidity → volume → `competitive` → `stable_event_id`.

## Hard selection rules

### 1. Resolution window (strict)

Per **candidate market** (representative pick): resolution time from `market.endDate` → `market.umaEndDate` → `event.endDate`. Must lie **strictly between** `now + 48h` and `now + 72h` (exclusive bounds).

### 2. Previously served events

Stable event ids in `served-events.json` are **never** selected again. No fallback overrides this.

**Pruning (file size):** On each `npm run create-round` invocation, the tool loads `served-events.json`, drops rows whose **`end_time` + 24 hours** is before **now** (resolution is over and a one-day buffer has passed), writes the file back if any row was removed, then builds the exclusion set. Rows **without** a valid `end_time` are **kept** (legacy rows); a warning is logged. New rows always store `end_time` (ISO) and `market_id` alongside `representative_market_id`. Dry-run (`npm run create-round:dry-run`) does **not** append or prune-write — it is read-only.

### 3. Category uniqueness (normal operation)

At most **one selected event** per derived category while the strict pass can still fill the request. After page exhaustion, category relaxation may repeat a category across **different** events.

### 4. Simple market structure

Representative must be **binary Yes/No** (`outcomes` exactly `["Yes","No"]`).

### 5. Low-dispute heuristics (v1)

Lightweight checks on the representative market and parent event (title length, archived/closed/inactive, obvious junk titles).

## Stable event identity

1. `event.id` → `eid:{id}`  
2. else `event.slug` → `slug:{slug}`  
3. else SHA-256 fingerprint of normalized metadata → `fp:{hex}`

## Persistence

| File | Role |
|------|------|
| `served-events.json` | Append **one row per returned event**: `stable_event_id`, `event_id`, `event_slug`, `representative_market_id`, `representative_market_slug`, `market_id` (same as representative id), **`end_time`** (ISO, representative resolution end, for pruning), `served_at`. Pruned automatically on each run. |
| `last-run-debug.json` | Last run diagnostics + new served rows (overwritten each non-dry run). |

## Retries (Gamma)

Wrapped `fetch` with timeout (`GAMMA_TIMEOUT_MS` per attempt) and exponential backoff; retries on network errors, timeouts, **429**, and **5xx**. Logs **attempt / maxAttempts**, **reason** (HTTP status or error name), backoff delay, and **final failure** after the last attempt.

**Note:** `SELECTION_BUDGET_MS` applies to the **whole** selection run and is enforced **between** page fetches; it does not abort an in-flight HTTP request.
