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
