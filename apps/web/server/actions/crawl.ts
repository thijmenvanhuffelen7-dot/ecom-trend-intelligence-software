"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, sql } from "@trendscope/db";
import { requireSession } from "@/lib/auth/server";

/** Zet een crawl-target vooraan in de rij; de scheduler pakt het binnen een minuut op. Alleen admins. */
export async function crawlNow(raw: { storeId: number }) {
  const session = await requireSession();
  if (session.role === "member" && !session.user.isPlatformAdmin) return { ok: false as const };
  const { storeId } = z.object({ storeId: z.number().int().positive() }).parse(raw);
  const db = getDb();
  const res = await db
    .updateTable("crawl_targets")
    .set({ next_run_at: sql`now()`, priority: 0, leased_until: null })
    .where("entity_id", "=", String(storeId))
    .where("connector_id", "=", "shopify_storefront")
    .executeTakeFirst();
  await db.insertInto("audit_logs").values({ workspace_id: session.workspace.id, actor_id: session.user.id, action: "crawl.now", target_type: "store", target_id: String(storeId) }).execute();
  revalidatePath(`/explorer/shops/${storeId}`);
  return { ok: Number(res.numUpdatedRows) > 0 };
}
