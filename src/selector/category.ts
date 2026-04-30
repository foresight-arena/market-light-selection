import type { GammaEvent, GammaMarket, GammaTag } from "../gamma/types.js";

export type SelectorCategory =
  | "crypto"
  | "sports"
  | "politics"
  | "finance"
  | "economy"
  | "geopolitics"
  | "tech"
  | "culture"
  | "weather"
  | "esports"
  | "elections"
  | "science"
  | "health"
  | "legal"
  | "environment"
  | "awards"
  | "other";

/**
 * Tie-break order when multiple categories have the same score (higher weight = earlier wins).
 * Crypto and sports are last so ambiguous markets prefer other verticals.
 */
const PRIORITY: SelectorCategory[] = [
  "elections",
  "geopolitics",
  "politics",
  "science",
  "health",
  "legal",
  "environment",
  "awards",
  "finance",
  "economy",
  "tech",
  "culture",
  "weather",
  "esports",
  "crypto",
  "sports",
  "other",
];

const TAG_SLUG_MAP: Record<string, SelectorCategory> = {
  crypto: "crypto",
  bitcoin: "crypto",
  ethereum: "crypto",
  defi: "crypto",
  sports: "sports",
  soccer: "sports",
  football: "sports",
  nfl: "sports",
  nba: "sports",
  mlb: "sports",
  ufc: "sports",
  tennis: "sports",
  f1: "sports",
  "formula-1": "sports",
  esports: "esports",
  politics: "politics",
  elections: "elections",
  election: "elections",
  geopolitics: "geopolitics",
  finance: "finance",
  economy: "economy",
  business: "finance",
  tech: "tech",
  technology: "tech",
  ai: "tech",
  culture: "culture",
  entertainment: "culture",
  movies: "culture",
  music: "culture",
  weather: "weather",
  science: "science",
  space: "science",
  nasa: "science",
  health: "health",
  medical: "health",
  legal: "legal",
  environment: "environment",
  climate: "environment",
  awards: "awards",
};

function haystack(event: GammaEvent, market: GammaMarket): string {
  const tagText = (event.tags ?? [])
    .map((t: GammaTag) => `${t.slug ?? ""} ${t.label ?? ""}`)
    .join(" ");
  return [
    event.category,
    event.title,
    event.slug,
    event.description,
    market.question,
    market.slug,
    tagText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function bump(
  scores: Partial<Record<SelectorCategory, number>>,
  cat: SelectorCategory,
  n: number
): void {
  scores[cat] = (scores[cat] ?? 0) + n;
}

/**
 * Deterministic category from tags, titles, slugs, and Gamma category field.
 * On equal scores, PRIORITY picks the label (crypto/sports lose ties to most other labels).
 */
export function deriveCategory(event: GammaEvent, market: GammaMarket): SelectorCategory {
  const scores: Partial<Record<SelectorCategory, number>> = {};

  for (const t of event.tags ?? []) {
    const s = t.slug?.toLowerCase().trim();
    if (s && TAG_SLUG_MAP[s]) {
      bump(scores, TAG_SLUG_MAP[s], 3);
    }
  }

  const text = haystack(event, market);

  const rules: [string, SelectorCategory][] = [
    // Science (before generic "crypto" token hits)
    ["nasa", "science"],
    ["spacex", "science"],
    [" james webb", "science"],
    ["particle", "science"],
    [" mars ", "science"],
    [" moon ", "science"],
    // Health
    ["vaccine", "health"],
    ["fda ", "health"],
    ["hospital", "health"],
    ["pandemic", "health"],
    ["covid", "health"],
    ["cancer ", "health"],
    // Legal
    ["supreme court", "legal"],
    ["lawsuit", "legal"],
    ["indictment", "legal"],
    ["trial ", "legal"],
    ["plea ", "legal"],
    ["doj ", "legal"],
    // Environment (long-horizon / policy; weather rules stay for short-range events)
    ["climate change", "environment"],
    ["carbon ", "environment"],
    ["net zero", "environment"],
    ["paris agreement", "environment"],
    ["renewable", "environment"],
    ["deforestation", "environment"],
    // Awards & culture prizes
    ["oscar", "awards"],
    ["grammy", "awards"],
    ["emmy", "awards"],
    ["golden globe", "awards"],
    ["nobel prize", "awards"],
    [" pulitzer", "awards"],
    // Crypto
    ["bitcoin", "crypto"],
    ["ethereum", "crypto"],
    ["crypto", "crypto"],
    ["token", "crypto"],
    ["defi", "crypto"],
    // Sports
    ["world cup", "sports"],
    ["nba ", "sports"],
    ["nfl", "sports"],
    ["mlb", "sports"],
    ["soccer", "sports"],
    ["ufc", "sports"],
    ["super bowl", "sports"],
    // Esports
    ["counter-strike", "esports"],
    ["dota", "esports"],
    ["league of legends", "esports"],
    ["valorant", "esports"],
    // Politics & elections
    ["president", "politics"],
    ["senate", "politics"],
    ["congress", "politics"],
    ["trump", "politics"],
    ["biden", "politics"],
    ["election", "elections"],
    ["vote", "elections"],
    ["geopolit", "geopolitics"],
    ["nato", "geopolitics"],
    ["war ", "geopolitics"],
    // Economy & finance
    ["gdp", "economy"],
    ["inflation", "economy"],
    ["fed ", "economy"],
    ["jobs report", "economy"],
    ["stock", "finance"],
    ["s&p", "finance"],
    ["nasdaq", "finance"],
    ["earnings", "finance"],
    // Tech
    ["openai", "tech"],
    ["google", "tech"],
    ["apple", "tech"],
    // Weather (short-horizon meteorology)
    ["hurricane", "weather"],
    ["temperature", "weather"],
  ];

  for (const [kw, cat] of rules) {
    if (text.includes(kw)) bump(scores, cat, 1);
  }

  let best: SelectorCategory = "other";
  let bestScore = scores.other ?? 0;
  for (const c of PRIORITY) {
    const v = scores[c] ?? 0;
    if (v > bestScore) {
      bestScore = v;
      best = c;
    } else if (v === bestScore && v > 0 && PRIORITY.indexOf(c) < PRIORITY.indexOf(best)) {
      best = c;
    }
  }

  return best;
}
