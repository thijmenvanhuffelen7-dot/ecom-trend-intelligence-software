import "server-only";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getDb } from "@trendscope/db";
import { AI_MODEL, aiClient } from "./assistant";
import { runTool } from "./tools";

export const ProductReportSchema = z.object({
  audience: z.object({ summary: z.string(), segments: z.array(z.string()) }),
  usps: z.array(z.string()),
  ad_angles: z.array(z.object({ angle: z.string(), hook: z.string(), why: z.string() })),
  pricing: z.object({ recommended_price: z.number(), reasoning: z.string() }),
  risks: z.array(z.object({ risk: z.string(), severity: z.enum(["low", "medium", "high"]) })),
  verdict: z.object({ summary: z.string(), confidence: z.enum(["low", "medium", "high"]) }),
});
export type ProductReport = z.infer<typeof ProductReportSchema>;

export const AdCopySchema = z.object({
  hooks: z.array(z.string()),
  primary_texts: z.array(z.string()),
  headlines: z.array(z.string()),
  description: z.string(),
  store_names: z.array(z.string()),
});
export type AdCopy = z.infer<typeof AdCopySchema>;

export type ReportKind = "product_report" | "ad_copy";
type Ctx = Awaited<ReturnType<typeof context>>;

/** Alle data waarop het rapport rust; de hash bepaalt of een eerder rapport nog geldig is. */
async function context(clusterId: number) {
  const product = (await runTool("get_product", { id: clusterId })) as Record<string, unknown> & { error?: string };
  if (product.error) return null;
  const db = getDb();
  const [ads, reddit] = await Promise.all([
    runTool("top_ads", { product_id: clusterId, active_only: false, sort: "longest_running", limit: 6 }) as Promise<{ headline: string | null; hook: string | null; days_running: number }[]>,
    db.selectFrom("reddit_mentions").select(["title", "subreddit", "score"]).where("cluster_id", "=", String(clusterId)).orderBy("score", "desc").limit(6).execute(),
  ]);
  return { product, ads: ads.map((a) => ({ headline: a.headline, hook: a.hook, days_running: a.days_running })), reddit };
}

const hash = (ctx: Ctx, locale: string) => createHash("sha256").update(JSON.stringify({ ctx, locale, v: 2 })).digest("hex").slice(0, 32);

const SYSTEM = (locale: "nl" | "en") => `You are a senior e-commerce strategist. You write for dropshippers and DTC brands who decide whether to sell a product.
Write in ${locale === "nl" ? "Dutch" : "English"}. Base every claim on the data provided; when data is missing or weak, say so in the text and lower the confidence.
Prices are in EUR. Sales, revenue and GMV figures in the data are estimates.`;

async function live(client: Anthropic, kind: ReportKind, ctx: NonNullable<Ctx>, locale: "nl" | "en") {
  const task =
    kind === "product_report"
      ? "Write a product report: target audience (summary + 2-4 segments), 3-5 USPs, 3-4 ad angles (each with a concrete hook and why it fits the signals), a recommended price with reasoning based on the price range, supplier cost and margin, 2-4 risks with severity, and a verdict with confidence."
      : "Write ad copy for Meta/TikTok: 5 scroll-stopping hooks (max 12 words), 3 primary texts (max 60 words, with a clear CTA), 5 headlines (max 8 words), one product description for the product page (80-120 words), and 5 brandable store-name ideas. No false claims, no health promises, no fake reviews.";
  const response = await client.beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: kind === "product_report" ? "high" : "medium",
      format: kind === "product_report" ? betaZodOutputFormat(ProductReportSchema) : betaZodOutputFormat(AdCopySchema),
    },
    system: SYSTEM(locale),
    messages: [{ role: "user", content: `${task}\n\n<data>\n${JSON.stringify(ctx)}\n</data>` }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("no_output");
  return response.parsed_output as ProductReport | AdCopy;
}

/** Offline: regelgebaseerd uit dezelfde data — eerlijk over wat het is, maar wel bruikbaar. */
function offline(kind: ReportKind, ctx: NonNullable<Ctx>, locale: "nl" | "en"): ProductReport | AdCopy {
  const nl = locale === "nl";
  const p = ctx.product as {
    title: string; niche: string | null; phase: string | null; scores: { opportunity: number; validation: number; saturation: number; growth_pct: number };
    signals: { signal: string; positive: boolean; growth_30d_pct: number }[]; price_range: [number | null, number | null];
    cheapest_suppliers: { price: number; shipping_cost: number | null }[]; stores: number; margin: number | null; search_terms: { term: string }[];
  };
  const rising = p.signals.filter((s) => s.positive).map((s) => s.signal);
  const cost = p.cheapest_suppliers[0] ? p.cheapest_suppliers[0].price + (p.cheapest_suppliers[0].shipping_cost ?? 0) : null;
  const lo = p.price_range[0] ?? (cost ? cost * 3 : 29.95);
  const hi = p.price_range[1] ?? lo * 1.3;
  const title = p.title;
  const short = title.split(" ").slice(-2).join(" ").toLowerCase();
  if (kind === "ad_copy") {
    return {
      hooks: nl
        ? [`Waarom heeft niemand het hierover? ${title}`, `Ik heb de ${short} 30 dagen getest`, `Dit lost het grootste probleem met ${short} op`, `Stop met scrollen als je dit herkent`, `De ${short} die TikTok niet stil krijgt`]
        : [`Why is nobody talking about the ${title}?`, `I tested the ${short} for 30 days`, `This fixes the biggest problem with ${short}`, `Stop scrolling if this sounds familiar`, `The ${short} TikTok can't stop talking about`],
      primary_texts: nl
        ? [`${title} — klein ding, groot verschil. Duizenden gingen je voor. Vandaag gratis verzending. Bestel nu ➜`, `Ken je dat? Met de ${short} is dat verleden tijd. Probeer 30 dagen zonder risico.`, `Nieuw in onze collectie: ${title}. Op = op. Bekijk hem nu.`]
        : [`${title} — small thing, big difference. Thousands already switched. Free shipping today. Shop now ➜`, `Sound familiar? With the ${short} that's history. Try it risk-free for 30 days.`, `New in: ${title}. Limited stock. See it now.`],
      headlines: nl ? [title, "Gratis verzending vandaag", "30 dagen proberen", "Bestseller van deze week", "Op = op"] : [title, "Free shipping today", "30-day trial", "This week's bestseller", "Limited stock"],
      description: nl
        ? `${title}: ontworpen voor elke dag. ${p.search_terms[0] ? `Mensen zoeken steeds vaker naar "${p.search_terms[0].term}" — ` : ""}en dit is waarom. Eenvoudig in gebruik, duurzaam gemaakt en getest door onze klanten. Bestel vandaag en ontvang hem binnen enkele dagen, met 30 dagen bedenktijd.`
        : `${title}: designed for every day. ${p.search_terms[0] ? `More and more people search for "${p.search_terms[0].term}" — ` : ""}and here's why. Easy to use, built to last and tested by our customers. Order today and get it within days, with a 30-day return window.`,
      store_names: [`${short.split(" ")[0]![0]!.toUpperCase()}${short.split(" ")[0]!.slice(1)}ly`, "Nestwise", "Brightnest", "Loomly", "Everhaus"],
    };
  }
  const sat = p.scores.saturation;
  const conf: "low" | "medium" | "high" = p.scores.validation >= 75 && sat < 0.5 ? "high" : p.scores.validation >= 50 ? "medium" : "low";
  return {
    audience: {
      summary: nl ? `Kopers in de niche ${p.niche ?? "algemeen"} die reageren op ${rising.includes("social") ? "social video" : "zoekgedrag"}.` : `Buyers in the ${p.niche ?? "general"} niche who respond to ${rising.includes("social") ? "social video" : "search intent"}.`,
      segments: nl ? ["Impulskopers via TikTok/Reels", "Cadeauzoekers", "Probleemoplossers via Google"] : ["Impulse buyers via TikTok/Reels", "Gift seekers", "Problem-solvers via Google"],
    },
    usps: nl ? ["Lost een herkenbaar dagelijks probleem op", "Goed te demonstreren in video", `Prijs onder €${Math.round(hi)}`] : ["Solves a recognisable daily problem", "Easy to demonstrate on video", `Priced under €${Math.round(hi)}`],
    ad_angles: (nl
      ? [["Probleem → oplossing", `Het probleem met ${short} — opgelost`, "Werkt bij producten met stijgende zoekinteresse"], ["Social proof", "Waarom iedereen dit nu koopt", rising.includes("ads") ? "Veel adverteerders bewijzen dat het converteert" : "Bouw vertrouwen bij nieuwe kopers"], ["Korting/urgentie", "Alleen deze week gratis verzending", "Verhoogt conversie bij impulsaankopen"]]
      : [["Problem → solution", `The problem with ${short} — solved`, "Works for products with rising search interest"], ["Social proof", "Why everyone is buying this right now", rising.includes("ads") ? "Many advertisers prove it converts" : "Builds trust with new buyers"], ["Discount/urgency", "Free shipping this week only", "Lifts conversion on impulse buys"]]
    ).map(([angle, hook, why]) => ({ angle: angle!, hook: hook!, why: why! })),
    pricing: {
      recommended_price: Math.round(((lo + hi) / 2) * 100) / 100 - 0.05,
      reasoning: nl
        ? `Winkels vragen €${lo.toFixed(2)}–€${hi.toFixed(2)}${cost ? `; goedkoopste inkoop incl. verzending €${cost.toFixed(2)}` : ""}. Het midden houdt ruimte voor ads (CPA) en retouren.`
        : `Stores charge €${lo.toFixed(2)}–€${hi.toFixed(2)}${cost ? `; cheapest landed cost €${cost.toFixed(2)}` : ""}. The middle leaves room for ad spend (CPA) and returns.`,
    },
    risks: [
      ...(sat > 0.6 ? [{ risk: nl ? `Hoge saturatie (${Math.round(sat * 100)}%): veel winkels en adverteerders` : `High saturation (${Math.round(sat * 100)}%): many stores and advertisers`, severity: "high" as const }] : []),
      ...(p.phase === "declining" || p.phase === "peak" ? [{ risk: nl ? `Fase "${p.phase}": de groei vlakt af` : `Phase "${p.phase}": growth is levelling off`, severity: "medium" as const }] : []),
      { risk: nl ? "Levertijd uit China kan retouren en klachten verhogen" : "Shipping time from China can increase returns and complaints", severity: "low" as const },
    ],
    verdict: {
      summary: nl
        ? `${title}: opportuniteit ${p.scores.opportunity}, validatie ${p.scores.validation} (${rising.length} positieve signalen: ${rising.join(", ") || "geen"}), saturatie ${Math.round(sat * 100)}%.`
        : `${title}: opportunity ${p.scores.opportunity}, validation ${p.scores.validation} (${rising.length} positive signals: ${rising.join(", ") || "none"}), saturation ${Math.round(sat * 100)}%.`,
      confidence: conf,
    },
  };
}

export async function getReport(clusterId: number, kind: ReportKind, locale: "nl" | "en") {
  return getDb()
    .selectFrom("ai_reports")
    .select(["content", "model", "created_at"])
    .where("entity_type", "=", "product_cluster")
    .where("entity_id", "=", String(clusterId))
    .where("kind", "=", kind)
    .where("locale", "=", locale)
    .orderBy("created_at", "desc")
    .executeTakeFirst();
}

/** Genereert (of hergebruikt, als de data niet veranderd is en het rapport < 7 dagen oud is) een rapport. */
export async function generateReport(clusterId: number, kind: ReportKind, locale: "nl" | "en", { force = false } = {}) {
  const ctx = await context(clusterId);
  if (!ctx) return null;
  const inputHash = hash(ctx, locale);
  const db = getDb();
  if (!force) {
    const cached = await db
      .selectFrom("ai_reports")
      .select(["content", "model", "created_at"])
      .where("entity_type", "=", "product_cluster").where("entity_id", "=", String(clusterId)).where("kind", "=", kind).where("locale", "=", locale)
      .where("input_hash", "=", inputHash).where("created_at", ">", new Date(Date.now() - 7 * 86_400_000))
      .orderBy("created_at", "desc").executeTakeFirst();
    if (cached) return cached;
  }
  const client = aiClient();
  const content = client ? await live(client, kind, ctx, locale) : offline(kind, ctx, locale);
  return db
    .insertInto("ai_reports")
    .values({ entity_type: "product_cluster", entity_id: String(clusterId), kind, locale, content: JSON.stringify(content), model: client ? AI_MODEL : "offline", input_hash: inputHash })
    .returning(["content", "model", "created_at"])
    .executeTakeFirstOrThrow();
}
