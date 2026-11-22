import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { getDb } from "@trendscope/db";
import { runTool, TOOL_DESCRIPTIONS, ToolInputs, type ToolName } from "./tools";

export const AI_MODEL = "claude-opus-5-5";

/** Live alleen met een expliciete sleutel; anders de offline-modus (zelfde tools, regelgebaseerd antwoord). */
export function aiClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  return new Anthropic();
}

export type ChatTurn = { role: "user" | "assistant"; text: string };
export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: ToolName; input: unknown }
  | { type: "tool_result"; name: ToolName; count: number | null }
  | { type: "done"; model: string }
  | { type: "error"; message: string };

function systemPrompt(locale: "nl" | "en") {
  // Stabiel (geen datum of gebruikersdata) zodat de prefix gecachet kan worden
  return `You are the research assistant inside Trendscope, an e-commerce trend and competitive-intelligence platform.
Answer in ${locale === "nl" ? "Dutch" : "English"}.

How to work:
- Use the tools to look things up; never invent products, numbers, stores or links. If the data doesn't answer the question, say so.
- Prefer a few precise tool calls over many broad ones. Call list_niches first only when you need a niche slug you don't know.
- Link every product, store, ad or search term you mention with the app path the tool returned, in Markdown: [name](/explorer/products/12).
- Revenue, traffic, GMV and sales figures are estimates: say so when you use them.
- Explain *why* something is promising using the score explanation (which signals are rising, saturation, margin), not just the score.
- Be concise: a short answer, then a compact list or table. No preamble.`;
}

/** Live: tool runner met streaming. Zelfde tools en schema's als de offline-modus. */
async function* live(client: Anthropic, history: ChatTurn[], locale: "nl" | "en"): AsyncGenerator<StreamEvent> {
  const tools = (Object.keys(ToolInputs) as ToolName[]).map((name) =>
    betaZodTool({
      name,
      description: TOOL_DESCRIPTIONS[name],
      inputSchema: ToolInputs[name],
      run: async (input) => JSON.stringify(await runTool(name, input)),
    }),
  );
  let runner = client.beta.messages.toolRunner({
    model: AI_MODEL,
    max_tokens: 16000,
    stream: true,
    max_iterations: 8,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // bij een weigering neemt de API een ander model over binnen dezelfde aanroep
    output_config: { effort: "medium" },
    system: [{ type: "text", text: systemPrompt(locale), cache_control: { type: "ephemeral" } }],
    tools,
    messages: history.map((m) => ({ role: m.role, content: m.text })),
  });
  for (let attempt = 0; ; attempt++) {
    try {
      for await (const messageStream of runner) {
        for await (const event of messageStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield { type: "text", text: event.delta.text };
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            yield { type: "tool", name: event.content_block.name as ToolName, input: {} };
          }
        }
        const message = await messageStream.finalMessage();
        attempt = 0;
        if (message.stop_reason === "refusal") {
          yield { type: "text", text: locale === "nl" ? "\n\nDit verzoek kan ik niet uitvoeren." : "\n\nI can't help with that request." };
          break;
        }
        if (message.stop_reason === "max_tokens" && message.content.some((b) => b.type === "tool_use")) break;
      }
      break;
    } catch (err) {
      if (err instanceof Anthropic.APIError || attempt >= 2) throw err;
      runner = client.beta.messages.toolRunner({ ...runner.params });
    }
  }
  yield { type: "done", model: AI_MODEL };
}

// ── Offline-modus ───────────────────────────────────────────────────────────────────────────────
type Plan = { tool: ToolName; input: Record<string, unknown> };

/** Eenvoudige intentieherkenning (NL/EN) → één tool-aanroep met filters uit de vraag. */
export async function planOffline(question: string): Promise<Plan> {
  const q = question.toLowerCase();
  const niches = await getDb().selectFrom("niches").select(["slug", "name_nl", "name_en"]).execute();
  // Woorden van minstens 4 letters uit slug en namen: "keukenproducten" → niche met "Keuken" in de naam
  const words = (n: { slug: string; name_nl: string; name_en: string }) =>
    `${n.slug} ${n.name_nl} ${n.name_en}`.toLowerCase().split(/[^a-zà-ÿ]+/).filter((w) => w.length >= 4 && !["home", "tools", "accessories"].includes(w));
  const niche = niches.find((n) => words(n).some((w) => q.includes(w)));
  const phase = /opkomend|emerging|nieuw|new/.test(q) ? "emerging" : /stijg|rising|groei|grow/.test(q) ? "rising" : undefined;
  const price = q.match(/(?:onder|under|below|<)\s*€?\s*(\d+)/);
  const aboutProducts = /product/.test(q);
  if (/tiktok/.test(q)) return { tool: "tiktok_top", input: { niche: niche?.slug, limit: 8 } };
  if (/hashtag/.test(q)) return { tool: "search_trends", input: { kind: "hashtag", phase, limit: 10 } };
  if (!aboutProducts && /zoekterm|keyword|trend|zoekt|search/.test(q)) return { tool: "search_trends", input: { phase: phase ?? "emerging", limit: 10 } };
  if (!aboutProducts && /\b(winkels?|webshops?|shops?|stores?|concurrenten|competitors?)\b/.test(q)) {
    return { tool: "search_stores", input: { niche: niche?.slug, sort: /nieuw|new/.test(q) ? "newest" : /groei|grow/.test(q) ? "growth" : "visits", limit: 8 } };
  }
  if (/\bads?\b|advert|creative/.test(q)) return { tool: "top_ads", input: { sort: "longest_running", limit: 8 } };
  return {
    tool: "search_products",
    input: {
      niches: niche ? [niche.slug] : undefined,
      phase,
      max_saturation: /weinig concurrentie|low competition|niet verzadigd|unsaturated|weinig winkels/.test(q) ? 0.35 : undefined,
      max_price: price ? Number(price[1]) : undefined,
      sort: /groei|grow|snel|fast/.test(q) ? "growth" : "opportunity",
      limit: 8,
    },
  };
}

function renderOffline(plan: Plan, rows: unknown, locale: "nl" | "en"): string {
  const nl = locale === "nl";
  const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  if (!list.length) return nl ? "Ik vond niets dat aan deze vraag voldoet. Probeer een bredere vraag of een andere niche." : "Nothing matched. Try a broader question or another niche.";
  const line = (r: Record<string, unknown>) => {
    const name = String(r.title ?? r.term ?? r.name ?? r.domain ?? r.headline ?? r.advertiser ?? "—");
    const link = r.url ? `[${name}](${String(r.url)})` : name;
    switch (plan.tool) {
      case "search_products":
        return `- ${link} — ${nl ? "opportuniteit" : "opportunity"} **${r.opportunity}**, ${nl ? "validatie" : "validation"} ${r.validation}, ${nl ? "saturatie" : "saturation"} ${Math.round(Number(r.saturation) * 100)}%, ${r.phase}`;
      case "search_trends":
        return `- ${link} — ${r.phase}, 30d ${Number(r.growth_30d) > 0 ? "+" : ""}${r.growth_30d}%${r.product ? ` · ${r.product}` : nl ? " · nog geen product" : " · no product yet"}`;
      case "search_stores":
        return `- ${link} (${r.country ?? "?"}) — ≈ ${r.monthly_visits_estimate ?? "—"} ${nl ? "bezoeken/mnd (schatting)" : "visits/mo (estimate)"}, +${r.products_added_7d} ${nl ? "producten in 7 dagen" : "products in 7 days"}`;
      case "top_ads":
        return `- ${link} — ${r.advertiser}, ${r.days_running} ${nl ? "dagen actief" : "days running"}, ${r.variants_count} ${nl ? "varianten" : "variants"}`;
      case "tiktok_top":
        return `- ${link} — ${r.units_30d ?? 0} ${nl ? "verkocht (30d)" : "sold (30d)"}, ≈ €${r.gmv_30d_estimate} GMV (${nl ? "schatting" : "estimate"}), ${r.shop}`;
      default:
        return `- ${link}`;
    }
  };
  const intro = {
    search_products: nl ? "Dit zijn de sterkste producten die bij je vraag passen:" : "These are the strongest products matching your question:",
    search_trends: nl ? "Snelst groeiende zoektermen:" : "Fastest-growing search terms:",
    search_stores: nl ? "Winkels die passen bij je vraag:" : "Stores matching your question:",
    top_ads: nl ? "Langst lopende actieve ads (een sterk teken dat ze winstgevend zijn):" : "Longest-running active ads (a strong sign they're profitable):",
    tiktok_top: nl ? "Best verkopende TikTok Shop-producten:" : "Best-selling TikTok Shop products:",
    get_product: "", list_niches: "",
  }[plan.tool];
  const note = nl
    ? "\n\nOffline-modus: zonder `ANTHROPIC_API_KEY` beantwoord ik vragen met vaste regels over dezelfde data. Met een sleutel krijg je de volledige assistent."
    : "\n\nOffline mode: without `ANTHROPIC_API_KEY` I answer with fixed rules over the same data. Add a key for the full assistant.";
  return `${intro}\n\n${list.map(line).join("\n")}${note}`;
}

async function* offline(history: ChatTurn[], locale: "nl" | "en"): AsyncGenerator<StreamEvent> {
  const question = [...history].reverse().find((m) => m.role === "user")?.text ?? "";
  const plan = await planOffline(question);
  yield { type: "tool", name: plan.tool, input: plan.input };
  let rows = await runTool(plan.tool, plan.input);
  let relaxed = false;
  // Geen treffers? Versoepel stap voor stap (eerst saturatie, dan fase, dan prijs) en zeg dat eerlijk
  for (const key of ["max_saturation", "phase", "max_price"]) {
    if (Array.isArray(rows) && rows.length === 0 && plan.input[key] !== undefined) {
      plan.input = { ...plan.input, [key]: undefined };
      relaxed = true;
      yield { type: "tool", name: plan.tool, input: plan.input };
      rows = await runTool(plan.tool, plan.input);
    }
  }
  yield { type: "tool_result", name: plan.tool, count: Array.isArray(rows) ? rows.length : null };
  const relaxNote = relaxed && Array.isArray(rows) && rows.length
    ? locale === "nl" ? "Geen exacte treffer met al je voorwaarden; dit komt het dichtst in de buurt.\n\n" : "No exact match for all your conditions; these come closest.\n\n"
    : "";
  const text = relaxNote + renderOffline(plan, rows, locale);
  for (let i = 0; i < text.length; i += 48) yield { type: "text", text: text.slice(i, i + 48) }; // zelfde stream-ervaring
  yield { type: "done", model: "offline" };
}

export function chat(history: ChatTurn[], locale: "nl" | "en"): AsyncGenerator<StreamEvent> {
  const client = aiClient();
  return client ? live(client, history, locale) : offline(history, locale);
}
