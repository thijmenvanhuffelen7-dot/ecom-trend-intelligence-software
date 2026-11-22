/** Funnelstappen en de tools die we per stap herkennen (via de technologiedetectie van de winkelpagina's). */
export const FUNNEL_STEPS = ["landing", "capture", "product", "cart", "checkout", "retention"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export const FUNNEL_TOOLS: Record<FunnelStep, Record<string, string>> = {
  landing: { PageFly: "builder", Shogun: "builder", "Zipify Pages": "builder", Intelligems: "abtest" },
  capture: { Privy: "popup", Justuno: "popup", OptiMonk: "popup", Wheelio: "spinwheel", Klaviyo: "form", Omnisend: "form", Mailchimp: "form", Postscript: "sms" },
  product: {
    "Judge.me": "reviews", Loox: "reviews", Okendo: "reviews", Yotpo: "reviews", Hurrify: "urgency", "Sales Pop": "socialproof",
    Vitals: "urgency", "Octane AI": "quiz", Gorgias: "chat", Tidio: "chat",
  },
  cart: { Rebuy: "upsell", "Frequently Bought Together": "bundle", "Bold Upsell": "upsell", "Hextom Free Shipping Bar": "freeshipping" },
  checkout: { Klarna: "bnpl", Afterpay: "bnpl", "Shopify Payments": "payment", PayPal: "payment", "Apple Pay": "payment", iDEAL: "payment", ReCharge: "subscription" },
  retention: { "Smile.io": "loyalty", LoyaltyLion: "loyalty", Klaviyo: "email", Omnisend: "email", Mailchimp: "email", Postscript: "sms", "Triple Whale": "analytics" },
};

export function funnelFor(techs: string[]): { step: FunnelStep; tools: { name: string; role: string }[] }[] {
  const set = new Set(techs);
  return FUNNEL_STEPS.map((step) => ({
    step,
    tools: Object.entries(FUNNEL_TOOLS[step]).filter(([name]) => set.has(name)).map(([name, role]) => ({ name, role })),
  }));
}
