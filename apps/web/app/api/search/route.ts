import { NextResponse } from "next/server";
import { getDb, sql } from "@trendscope/db";
import { getSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

type ShopHit = { id: number; name: string | null; domain: string; country: string | null; screenshot_url: string | null };
type ProductHit = { id: number; title: string; image_url: string | null; phase: string | null; opportunity: number | null };

async function meili(q: string): Promise<{ shops: ShopHit[]; products: ProductHit[] } | null> {
  const url = process.env.MEILISEARCH_URL;
  if (!url) return null;
  try {
    const res = await fetch(`${url}/multi-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.MEILISEARCH_MASTER_KEY ?? ""}` },
      body: JSON.stringify({
        queries: [
          { indexUid: "stores", q, limit: 6, attributesToRetrieve: ["id", "name", "domain", "country", "screenshot_url"] },
          { indexUid: "products", q, limit: 6, attributesToRetrieve: ["id", "title", "image_url", "phase", "opportunity"] },
        ],
      }),
      signal: AbortSignal.timeout(800),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results: { hits: unknown[] }[] };
    return { shops: data.results[0]!.hits as ShopHit[], products: data.results[1]!.hits as ProductHit[] };
  } catch {
    return null; // Meilisearch onbereikbaar → Postgres-terugval
  }
}

async function postgres(q: string) {
  const db = getDb();
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const [shops, products] = await Promise.all([
    db
      .selectFrom("stores")
      .select([sql<number>`id::int`.as("id"), "name", "domain", "country", "screenshot_url"])
      .where((eb) => eb.or([eb("name", "ilike", like), eb("domain", "ilike", like)]))
      .orderBy("monthly_visits", sql`desc nulls last`)
      .limit(6)
      .execute(),
    db
      .selectFrom("product_clusters as c")
      .leftJoin("scores as s", (j) => j.onRef("s.entity_id", "=", "c.id").on("s.entity_type", "=", "product_cluster"))
      .select([sql<number>`c.id::int`.as("id"), "c.canonical_title as title", "c.image_url", sql<string | null>`s.phase::text`.as("phase"), "s.opportunity"])
      .where("c.canonical_title", "ilike", like)
      .orderBy("s.opportunity", sql`desc nulls last`)
      .limit(6)
      .execute(),
  ]);
  return { shops, products };
}

export async function GET(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (!q) return NextResponse.json({ shops: [], products: [], engine: "none" });
  const fast = await meili(q);
  return NextResponse.json(fast ? { ...fast, engine: "meilisearch" } : { ...(await postgres(q)), engine: "postgres" });
}
