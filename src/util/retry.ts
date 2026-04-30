import { logError, logWarn } from "./log.js";

export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  label: string;
};

const defaultOptions: RetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  timeoutMs: 30_000,
  label: "request",
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Retries on network failure, timeout, 5xx, and 429 with exponential backoff.
 * Does not swallow errors: the last attempt throws or returns a non-retryable response.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit | undefined,
  options: Partial<RetryOptions> = {}
): Promise<Response> {
  const o = { ...defaultOptions, ...options };
  let lastErr: unknown;

  for (let attempt = 1; attempt <= o.maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init ?? {}, o.timeoutMs);
      if (!isRetryableStatus(res.status) || attempt === o.maxAttempts) {
        return res;
      }
      const delay = Math.min(
        o.maxDelayMs,
        o.baseDelayMs * 2 ** (attempt - 1)
      );
      logWarn(`${o.label}: retryable HTTP status, backing off`, {
        attempt,
        maxAttempts: o.maxAttempts,
        reason: `HTTP ${res.status}`,
        delayMs: delay,
        url,
      });
      await sleep(delay);
    } catch (e) {
      lastErr = e;
      if (attempt === o.maxAttempts) {
        const name = e instanceof Error ? e.name : "unknown";
        const msg = e instanceof Error ? e.message : String(e);
        logError(`${o.label}: final failure after all attempts`, {
          attempts: o.maxAttempts,
          maxAttempts: o.maxAttempts,
          url,
          errorName: name,
          message: msg,
        });
        throw e;
      }
      const delay = Math.min(
        o.maxDelayMs,
        o.baseDelayMs * 2 ** (attempt - 1)
      );
      const name = e instanceof Error ? e.name : "unknown";
      const reason =
        name === "AbortError" ? "timeout/abort" : `network error (${name})`;
      logWarn(`${o.label}: ${reason}, retrying`, {
        attempt,
        maxAttempts: o.maxAttempts,
        delayMs: delay,
        url,
        message: e instanceof Error ? e.message : String(e),
      });
      await sleep(delay);
    }
  }

  throw lastErr ?? new Error(`${o.label}: exhausted retries`);
}

export function parseRetryEnv(): Partial<RetryOptions> {
  const maxAttempts = Number(process.env.GAMMA_RETRY_MAX_ATTEMPTS);
  const baseDelayMs = Number(process.env.GAMMA_RETRY_BASE_DELAY_MS);
  const maxDelayMs = Number(process.env.GAMMA_RETRY_MAX_DELAY_MS);
  const timeoutMs = Number(process.env.GAMMA_TIMEOUT_MS);
  const out: Partial<RetryOptions> = {};
  if (Number.isFinite(maxAttempts) && maxAttempts > 0) out.maxAttempts = maxAttempts;
  if (Number.isFinite(baseDelayMs) && baseDelayMs > 0) out.baseDelayMs = baseDelayMs;
  if (Number.isFinite(maxDelayMs) && maxDelayMs > 0) out.maxDelayMs = maxDelayMs;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) out.timeoutMs = timeoutMs;
  return out;
}
