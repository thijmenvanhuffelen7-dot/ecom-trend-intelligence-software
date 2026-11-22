import "server-only";
import { getDb, sql } from "@trendscope/db";
import { sanitizeEmailHtml } from "@/lib/sanitize-email";
import { list, num, oneOf, page, str, type SearchParams } from "./params";

export const EMAIL_TYPES = ["welcome", "promotion", "product_launch", "newsletter", "abandoned_cart", "confirmation", "transactional", "other"] as const;
export const EMAIL_PAGE = 30;

export function parseEmailFilters(sp: SearchParams) {
  return {
    q: str(sp, "q", 80)?.trim() || undefined,
    types: list(sp, "type", EMAIL_TYPES),
    minDiscount: num(sp, "mindisc"),
    urgency: str(sp, "urgency") === "1",
    store: num(sp, "store"),
    sort: oneOf(sp, "sort", ["newest", "discount"] as const, "newest"),
    page: page(sp),
  };
}
export type EmailFilters = ReturnType<typeof parseEmailFilters>;

export async function searchEmails(f: EmailFilters) {
  let q = getDb().selectFrom("emails as e").innerJoin("stores as s", "s.id", "e.store_id");
  if (f.q) q = q.where("e.subject", "ilike", `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (f.types.length) q = q.where("e.type", "in", f.types);
  if (f.minDiscount !== undefined) q = q.where("e.discount_pct", ">=", f.minDiscount);
  if (f.urgency) q = q.where("e.urgency", "=", true);
  if (f.store !== undefined) q = q.where("e.store_id", "=", String(f.store));
  const { total } = await q.select(sql<number>`count(*)::int`.as("total")).executeTakeFirstOrThrow();
  const rows = await q
    .select([
      "e.id", "e.subject", "e.preheader", "e.received_at", "e.type", "e.discount_pct", "e.discount_code", "e.free_shipping",
      "e.urgency", "e.esp", "s.id as store_id", "s.name as store_name", "s.domain", "s.screenshot_url",
      sql<number>`jsonb_array_length(coalesce((select jsonb_agg(l) from jsonb_array_elements(e.links) l where l ? 'product_id'), '[]'))`.as("product_links"),
    ])
    .orderBy(f.sort === "discount" ? sql`e.discount_pct desc nulls last` : sql`e.received_at desc`)
    .orderBy("e.id", "desc")
    .limit(EMAIL_PAGE)
    .offset((f.page - 1) * EMAIL_PAGE)
    .execute();
  return { total, rows };
}

export async function getEmail(id: number, images: boolean) {
  const db = getDb();
  const e = await db
    .selectFrom("emails as e")
    .leftJoin("stores as s", "s.id", "e.store_id")
    .selectAll("e")
    .select(["s.name as store_name", "s.domain", "s.emails_per_week", "s.avg_discount_pct"])
    .where("e.id", "=", String(id))
    .executeTakeFirst();
  if (!e) return null;
  const links = (e.links as { url: string; product_id?: number }[]) ?? [];
  const productIds = [...new Set(links.map((l) => l.product_id).filter((x): x is number => typeof x === "number"))];
  const products = productIds.length
    ? await db
        .selectFrom("products as p")
        .leftJoin("cluster_members as m", "m.product_id", "p.id")
        .select(["p.id", "p.title", "p.price", "p.currency", sql<string | null>`p.images[1]`.as("image"), "m.cluster_id"])
        .where("p.id", "in", productIds.map(String))
        .execute()
    : [];
  const blocked = /<img\b[^>]*\bsrc\s*=\s*["']https?:/i.test(e.body_html ?? "");
  return { email: e, html: e.body_html ? sanitizeEmailHtml(e.body_html, { images }) : null, products, hasRemoteImages: blocked };
}

/** Per winkel: cadans (mails per week, 12 weken), mix van types en de laatste mails. */
export async function storeEmailSummary(storeId: string) {
  const db = getDb();
  const [recent, mix, weekly, sub] = await Promise.all([
    db
      .selectFrom("emails")
      .select(["id", "subject", "received_at", "type", "discount_pct", "urgency"])
      .where("store_id", "=", storeId)
      .orderBy("received_at", "desc")
      .limit(8)
      .execute(),
    db.selectFrom("emails").select(["type", sql<number>`count(*)::int`.as("n")]).where("store_id", "=", storeId).groupBy("type").execute(),
    db
      .selectFrom("emails")
      .select([sql<string>`to_char(date_trunc('week', received_at), 'YYYY-MM-DD')`.as("week"), sql<number>`count(*)::int`.as("n")])
      .where("store_id", "=", storeId)
      .where("type", "not in", ["confirmation", "transactional"])
      .groupBy(sql`date_trunc('week', received_at)`)
      .orderBy(sql`date_trunc('week', received_at)`)
      .execute(),
    db.selectFrom("email_subscriptions").select(["status", "subscribed_at", "confirmed_at"]).where("store_id", "=", storeId).executeTakeFirst(),
  ]);
  return { recent, mix, weekly: weekly.map((w) => [w.week, w.n] as [string, number]), subscription: sub ?? null };
}

