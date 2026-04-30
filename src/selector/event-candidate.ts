import type { GammaEvent, GammaMarket } from "../gamma/types.js";
import type { SelectorCategory } from "./category.js";

/**
 * One row per event: a single representative market chosen for that event.
 */
export type EventCandidate = {
  pageIndex: number;
  eventIndex: number;
  event: GammaEvent;
  market: GammaMarket;
  stableEventId: string;
  category: SelectorCategory;
  resolutionEndMs: number;
};
