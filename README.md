# Lightweight Polymarket Selector

## Overview

CLI tool that picks **5–10** Polymarket-style markets per round from the public **Gamma** `GET /events` API and submits them on-chain via `RoundManager.createRound`. Selection is **event-first** (one representative market per event), ranked by volume-style ordering, with **category diversity** and a strict **48–72 hour** resolution window. **No database, no HTTP server** — state is a single JSON file (`data/served-events.json`) used to avoid repeating events across rounds.

## Key Features

- **Event-first:** at most one market per `stable_event_id` per round
- **Category diversity:** unique categories in the primary pass; relaxation only after search is exhausted
- **48–72h window:** representative resolution end strictly between now+48h and now+72h
- **Deep scan:** up to `GAMMA_MAX_PAGES` of Gamma results per run (default 20)
- **Cross-round memory:** events in `served-events.json` are excluded until pruned
- **Gamma resilience:** retries on timeouts, network errors, **429**, and **5xx**; automatic `order` fallback if Gamma returns **422**
- **Pruning:** served rows dropped when `now > end_time + 24h` (runs on every selection)

## CLI

The repo exposes **two** npm scripts:

### `npm run create-round`

Selects markets, computes the round timeline, and sends `createRound` to the configured `RoundManager`. Appends selected events to `served-events.json` so they will not be picked again.

```bash
npm run create-round
```

### `npm run create-round:dry-run`

Same selection logic, but **does not** send any transaction and **does not** append to `served-events.json`. Prints the payload that would be sent. RPC / wallet env vars are not required in dry-run mode.

```bash
npm run create-round:dry-run
```

## Configuration

`.env` (loaded via `dotenv`):

| Variable | Required | Role |
|----------|----------|------|
| `MIN_MARKETS` | yes | Number of markets per round (the selector requests this count). |
| `COMMIT_HOURS` | yes | Hours from now to the commit deadline. |
| `REVEAL_HOURS` | yes | Length of the reveal window (hours). |
| `PRIVATE_KEY` | yes (live only) | Signing key for `createRound`. Not needed in dry-run. |
| `RPC_URL` | yes (live only) | EVM RPC endpoint. Not needed in dry-run. |
| `ROUND_MANAGER_ADDRESS` | yes (live only) | Deployed `RoundManager` address. Not needed in dry-run. |
| `GAMMA_MAX_PAGES` | no | Cap on `/events` pages per run (default `20`). |
| `GAMMA_PAGE_SIZE` | no | `/events` `limit` per page (default `100`). |
| `GAMMA_DISABLE_END_DATE_FILTER` | no | Set to `1` to omit `end_date_min` / `end_date_max` on Gamma. |
| `SELECTION_BUDGET_MS` | no | Wall-clock budget for selection, checked between pages (default `45000`). |
| `LIGHTWEIGHT_SELECTOR_DATA_DIR` | no | Where `served-events.json` lives (default `./data`). |

## Selection Behavior

- Fills `MIN_MARKETS` whenever enough qualifying events exist in Gamma after rules above; otherwise exits non-zero
- Scans **multiple Gamma pages** until strict fill, short page, max pages, or **selection budget** between pages
- **Category relaxation** (duplicate categories allowed) only **after** the fetch phase ends — never mid-scan
- **Never** two markets from the same event in one round
- **Previously served** stable event ids stay excluded until row is pruned

## Round Timeline

Computed deterministically from env values (all timestamps floored to the hour):

- `commit_deadline = floorHour(now + COMMIT_HOURS * 1h)`
- `reveal_start = max(floorHour(now + 72h), earliest_resolution_end_of_picked_markets)`
- `reveal_end = reveal_start + REVEAL_HOURS * 1h`

## Storage

| File | Purpose |
|------|---------|
| `data/served-events.json` | Append-only log of served events (`stable_event_id`, `end_time`, `served_at`, …); **pruned** on each run when `end_time + 24h` is in the past. Gitignored — local state only. |
| `data/last-run-debug.json` | Last run's diagnostics + new served records (overwritten each run). Gitignored. |

## Methodology

See [`docs/methodology.md`](docs/methodology.md).
