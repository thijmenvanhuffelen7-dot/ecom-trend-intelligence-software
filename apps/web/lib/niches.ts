/** Emoji per niche (gelijk aan de seed-catalogus). */
export const NICHE_EMOJI: Record<string, string> = {
  "food-grocery": "🥫",
  "natural-health": "🌿",
  skincare: "🧴",
  "home-kitchen": "🍳",
  fitness: "🏋️",
  pets: "🐾",
  "baby-kids": "🧸",
  "fashion-accessories": "👜",
  "tech-gadgets": "🔌",
  "home-decor": "🪴",
  outdoor: "🏕️",
  "beauty-tools": "💄",
};

export type NicheRow = { slug: string; name_nl: string; name_en: string };

export function nicheName(n: NicheRow | undefined, locale: string): string {
  if (!n) return "";
  return locale === "nl" ? n.name_nl : n.name_en;
}
