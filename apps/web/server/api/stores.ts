import "server-only";
import { getDb } from "@trendscope/db";
import { storeDetail, type StoreRecord } from "./serialize";

/** Domein normaliseren zoals de crawler: kleine letters, zonder schema, pad, poort en "www.". */
export function normalizeDomain(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw || raw.length > 253) return null;
  let host = raw;
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : null;
}

export async function storeForApi(where: { id: number } | { domain: string }) {
  const db = getDb();
  let q = db.selectFrom("stores as s").leftJoin("niches as n", "n.id", "s.niche_id").selectAll("s").select("n.slug as niche_slug");
  q = "id" in where ? q.where("s.id", "=", String(where.id)) : q.where((eb) => eb.or([eb("s.domain", "=", where.domain), eb("s.shopify_domain", "=", where.domain)]));
  const s = await q.executeTakeFirst();
  if (!s) return null;
  const [tech, top] = await Promise.all([
    db.selectFrom("store_technologies").select(["type", "name"]).where("store_id", "=", s.id).where("removed_at", "is", null).orderBy("type").orderBy("name").execute(),
    db
      .selectFrom("entity_links as l")
      .innerJoin("product_clusters as c", "c.id", "l.to_id")
      .leftJoin("scores as sc", (j) => j.onRef("sc.entity_id", "=", "c.id").on("sc.entity_type", "=", "product_cluster"))
      .select(["c.id", "c.canonical_title", "sc.opportunity", "sc.phase"])
      .where("l.from_type", "=", "store")
      .where("l.from_id", "=", s.id)
      .where("l.to_type", "=", "product_cluster")
      .orderBy("sc.opportunity", (ob) => ob.desc().nullsLast())
      .limit(5)
      .execute(),
  ]);
  return storeDetail(s as unknown as StoreRecord, tech, top);
}
