#!/usr/bin/env tsx
import "dotenv/config";
import { createWalletClient, createPublicClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getDataDir, getMaxPages, getGammaPageSize } from "../src/config.js";
import { executeSelect } from "../src/execute-select.js";
import { logInfo, logError } from "../src/util/log.js";

const DRY_RUN = process.argv.slice(2).includes("--dry-run");

/* ── env ─────────────────────────────────────────────────────────── */

function requireEnv(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) { console.error(`Missing env: ${key}`); process.exit(1); }
  return v;
}

const MIN_MARKETS  = Number(requireEnv("MIN_MARKETS"));
const REVEAL_HOURS = Number(requireEnv("REVEAL_HOURS"));
const COMMIT_HOURS = Number(requireEnv("COMMIT_HOURS"));

if (!Number.isFinite(MIN_MARKETS) || MIN_MARKETS < 1)
  { console.error("MIN_MARKETS must be a positive integer"); process.exit(1); }

const PRIVATE_KEY   = DRY_RUN ? null : (requireEnv("PRIVATE_KEY")           as Hex);
const RPC_URL       = DRY_RUN ? null :  requireEnv("RPC_URL");
const ROUND_MANAGER = DRY_RUN ? null : (requireEnv("ROUND_MANAGER_ADDRESS") as Hex);

/* ── select markets ──────────────────────────────────────────────── */

logInfo(DRY_RUN ? "Selecting markets (dry run)…" : "Selecting markets…", { count: MIN_MARKETS });

const { response } = await executeSelect({
  requestedCount: MIN_MARKETS,
  dataDir: getDataDir(),
  maxPages: getMaxPages(),
  pageSize: getGammaPageSize(),
  dryRun: DRY_RUN,
});

const conditionIds = response.markets
  .map((m) => m.condition_id)
  .filter((id): id is string => id !== null && id !== "") as Hex[];

if (conditionIds.length < MIN_MARKETS) {
  logError("Not enough markets with condition_id", {
    needed: MIN_MARKETS,
    got: conditionIds.length,
  });
  process.exit(1);
}

/* ── timeline ────────────────────────────────────────────────────── */

const nowSec = Math.floor(Date.now() / 1000);
const HOUR = 3600;

function floorHour(ts: number): number {
  return ts - (ts % HOUR);
}

const commitDeadline = floorHour(nowSec + COMMIT_HOURS * HOUR);

const earliestResolutionSec = Math.min(
  ...response.markets.map((m) => Math.floor(m.resolution_end_ms / 1000)),
);
const revealStartCandidate = floorHour(nowSec + 72 * HOUR);
const revealStart = Math.max(revealStartCandidate, earliestResolutionSec);
const revealEnd = revealStart + REVEAL_HOURS * HOUR;

logInfo("Timeline", {
  commit_deadline: new Date(commitDeadline * 1000).toISOString(),
  reveal_start:    new Date(revealStart * 1000).toISOString(),
  reveal_end:      new Date(revealEnd * 1000).toISOString(),
});

/* ── dry run: print and exit ─────────────────────────────────────── */

if (DRY_RUN) {
  console.log(JSON.stringify({
    dry_run: true,
    condition_ids: conditionIds,
    commit_deadline: commitDeadline,
    reveal_start: revealStart,
    reveal_end: revealEnd,
    markets: response.markets.map((m) => ({
      title: m.title,
      condition_id: m.condition_id,
      end_date: m.end_date,
    })),
  }, null, 2));
  process.exit(0);
}

/* ── send tx ─────────────────────────────────────────────────────── */

const abi = parseAbi([
  "function createRound(bytes32[],uint64,uint64,uint64)",
]);

const account = privateKeyToAccount(PRIVATE_KEY!);
const transport = http(RPC_URL!);

const publicClient = createPublicClient({ transport });
const walletClient = createWalletClient({ account, transport });

const chainId = await publicClient.getChainId();
logInfo("Sending createRound", {
  chain: chainId,
  contract: ROUND_MANAGER,
  markets: conditionIds.length,
});

const hash = await walletClient.writeContract({
  address: ROUND_MANAGER!,
  abi,
  functionName: "createRound",
  args: [
    conditionIds,
    BigInt(commitDeadline),
    BigInt(revealStart),
    BigInt(revealEnd),
  ],
  chain: { id: chainId } as any,
});

logInfo("Tx sent", { hash });

const receipt = await publicClient.waitForTransactionReceipt({ hash });
logInfo("Tx confirmed", {
  hash: receipt.transactionHash,
  block: receipt.blockNumber.toString(),
  status: receipt.status,
});

if (receipt.status !== "success") {
  console.error("Transaction reverted");
  process.exit(1);
}

console.log(JSON.stringify({
  tx_hash: receipt.transactionHash,
  block: receipt.blockNumber.toString(),
  condition_ids: conditionIds,
  commit_deadline: commitDeadline,
  reveal_start: revealStart,
  reveal_end: revealEnd,
  markets: response.markets.map((m) => ({
    title: m.title,
    condition_id: m.condition_id,
    end_date: m.end_date,
  })),
}, null, 2));
