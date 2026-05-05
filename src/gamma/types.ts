/** Partial Gamma API shapes — only fields we read. */

export type GammaTag = {
  id?: string;
  label?: string;
  slug?: string;
};

export type GammaMarket = {
  id?: string;
  slug?: string;
  question?: string;
  conditionId?: string;
  outcomes?: string;
  outcomePrices?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  volume?: string | number;
  volumeNum?: number;
  liquidity?: string | number;
  liquidityNum?: number;
  competitive?: number;
  umaEndDate?: string;
  /**
   * Scheduled event start, in non-standard `"YYYY-MM-DD HH:MM:SS+00"` form.
   * Present on sports markets (where `sportsMarketType` is set) and also as a
   * window-start on some non-sports markets (e.g. crude-oil monthly bands).
   * For sports it is often *later* than `endDate` (NBA games tip off the next
   * UTC day after the listed `endDate`), so resolution-time logic must
   * consider both.
   */
  gameStartTime?: string;
  /** Set on sports markets; presence is a strong signal `gameStartTime` is the actual game tip-off. */
  sportsMarketType?: string;
};

export type GammaEvent = {
  id?: string;
  slug?: string;
  title?: string;
  description?: string;
  category?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  endDate?: string;
  tags?: GammaTag[];
  liquidity?: number;
  volume?: number;
  volume24hr?: number;
  competitive?: number;
  markets?: GammaMarket[];
};
