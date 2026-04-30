import { createHash } from "node:crypto";
import type { GammaEvent } from "../gamma/types.js";

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Stable identity for an event: event_id → event_slug → deterministic fingerprint.
 */
export function stableEventId(event: GammaEvent): string {
  const rawId = event.id?.trim();
  if (rawId) return `eid:${rawId}`;

  const slug = event.slug?.trim();
  if (slug) return `slug:${slug}`;

  const title = normalize(event.title ?? "");
  const desc = normalize((event.description ?? "").slice(0, 200));
  const marketsLen = Array.isArray(event.markets) ? event.markets.length : 0;
  const payload = JSON.stringify({
    title,
    desc,
    marketsLen,
  });
  const h = createHash("sha256").update(payload).digest("hex");
  return `fp:${h}`;
}
