"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@trendscope/db";
import { can } from "@trendscope/core";
import { requireSession } from "@/lib/auth/server";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { featureEnabled } from "@/server/flags";
import { createDraftProduct, normalizeShopDomain, ShopifyError, shopifyMode, textToHtml, TOKEN_RE, verifyShop } from "@/server/shopify";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export async function connectShopify(raw: { domain: string; token: string }): Promise<Result> {
  const session = await requireSession();
  if (!can(session.role, "workspace.update")) return { ok: false, error: "forbidden" };
  if (!(await featureEnabled("push_to_store", session))) return { ok: false, error: "plan" };
  const domain = normalizeShopDomain(raw.domain ?? "");
  const token = String(raw.token ?? "").trim();
  if (!domain) return { ok: false, error: "domain" };
  if (!TOKEN_RE.test(token)) return { ok: false, error: "token" };
  let name: string;
  try {
    name = (await verifyShop(domain, token)).name; // controleert het token direct, zodat een tikfout niet pas bij de eerste push opvalt
  } catch (e) {
    return { ok: false, error: e instanceof ShopifyError ? e.code : "network" };
  }
  const db = getDb();
  await db
    .insertInto("shop_connections")
    .values({ workspace_id: session.workspace.id, shop_domain: domain, token_enc: encryptJson({ token }), shop_name: name, mode: shopifyMode(), created_by: session.user.id })
    .onConflict((oc) => oc.columns(["workspace_id", "shop_domain"]).doUpdateSet({ token_enc: encryptJson({ token }), shop_name: name, mode: shopifyMode(), last_error: null }))
    .execute();
  await db.insertInto("audit_logs").values({ workspace_id: session.workspace.id, actor_id: session.user.id, action: "shopify.connect", target_type: "shop_connection", target_id: domain }).execute();
  revalidatePath("/settings");
  return { ok: true };
}

export async function disconnectShopify(id: string): Promise<Result> {
  const session = await requireSession();
  if (!can(session.role, "workspace.update")) return { ok: false, error: "forbidden" };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  await getDb().deleteFrom("shop_connections").where("id", "=", id).where("workspace_id", "=", session.workspace.id).execute();
  await getDb().insertInto("audit_logs").values({ workspace_id: session.workspace.id, actor_id: session.user.id, action: "shopify.disconnect", target_type: "shop_connection", target_id: id }).execute();
  revalidatePath("/settings");
  return { ok: true };
}

const Push = z.object({
  clusterId: z.number().int().positive(),
  connectionId: z.string().uuid(),
  title: z.string().trim().min(2).max(255),
  description: z.string().max(5000).default(""),
  price: z.number().positive().max(100_000),
});

/** Product als concept naar de eigen Shopify-winkel. Geen afbeeldingen van andere winkels (auteursrecht): die voegt de gebruiker zelf toe. */
export async function pushToShopify(raw: z.input<typeof Push>): Promise<Result<{ adminUrl: string }>> {
  const session = await requireSession();
  if (!can(session.role, "watchlist.write")) return { ok: false, error: "forbidden" };
  if (!(await featureEnabled("push_to_store", session))) return { ok: false, error: "plan" };
  const p = Push.safeParse(raw);
  if (!p.success) return { ok: false, error: "invalid" };
  const db = getDb();
  const [conn, cluster] = await Promise.all([
    db.selectFrom("shop_connections").selectAll().where("id", "=", p.data.connectionId).where("workspace_id", "=", session.workspace.id).executeTakeFirst(),
    db.selectFrom("product_clusters as c").leftJoin("niches as n", "n.id", "c.niche_id").select(["c.id", "n.name_en as niche"]).where("c.id", "=", String(p.data.clusterId)).executeTakeFirst(),
  ]);
  if (!conn || !cluster) return { ok: false, error: "not_found" };
  const payload = { title: p.data.title, descriptionHtml: textToHtml(p.data.description), price: Math.round(p.data.price * 100) / 100, productType: cluster.niche, tags: ["trendscope", `trendscope-${cluster.id}`] };
  try {
    const { token } = decryptJson<{ token: string }>(conn.token_enc);
    const created = await createDraftProduct(conn.shop_domain, token, payload);
    await db.insertInto("store_pushes").values({ workspace_id: session.workspace.id, connection_id: conn.id, cluster_id: cluster.id, status: "created", remote_product_id: created.id, remote_admin_url: created.adminUrl, payload: JSON.stringify(payload), created_by: session.user.id }).execute();
    await db.updateTable("shop_connections").set({ last_used_at: new Date(), last_error: null }).where("id", "=", conn.id).execute();
    revalidatePath(`/explorer/products/${cluster.id}`);
    return { ok: true, adminUrl: created.adminUrl };
  } catch (e) {
    const code = e instanceof ShopifyError ? e.code : "network";
    const message = e instanceof Error ? e.message.slice(0, 300) : "unknown";
    await db.insertInto("store_pushes").values({ workspace_id: session.workspace.id, connection_id: conn.id, cluster_id: cluster.id, status: "failed", payload: JSON.stringify(payload), error: message, created_by: session.user.id }).execute();
    await db.updateTable("shop_connections").set({ last_error: message }).where("id", "=", conn.id).execute();
    return { ok: false, error: code };
  }
}
