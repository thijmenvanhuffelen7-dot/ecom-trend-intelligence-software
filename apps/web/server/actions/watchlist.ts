"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, sql } from "@trendscope/db";
import { assertCan, assertWithinLimit, LimitExceededError } from "@trendscope/core";
import { requireSession } from "@/lib/auth/server";

const Input = z.object({ entityType: z.enum(["store", "product_cluster", "advertiser", "creator", "keyword"]), entityId: z.coerce.number().int().positive() });

export type WatchResult = { ok: true; watching: boolean } | { ok: false; error: "limit" | "forbidden"; message: string };

/** Volgt of ontvolgt een entiteit voor de huidige workspace (met planlimiet en audit-log). */
export async function toggleWatch(raw: z.input<typeof Input>): Promise<WatchResult> {
  const session = await requireSession();
  const { entityType, entityId } = Input.parse(raw);
  try {
    assertCan(session.role, "watchlist.write");
  } catch (e) {
    return { ok: false, error: "forbidden", message: (e as Error).message };
  }
  const db = getDb();
  const result = await db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom("watchlists")
      .select("id")
      .where("workspace_id", "=", session.workspace.id)
      .where("entity_type", "=", entityType)
      .where("entity_id", "=", String(entityId))
      .executeTakeFirst();
    if (existing) {
      await trx.deleteFrom("watchlists").where("id", "=", existing.id).execute();
      return { watching: false };
    }
    if (entityType === "store") {
      const { n } = await trx
        .selectFrom("watchlists")
        .select(sql<number>`count(*)::int`.as("n"))
        .where("workspace_id", "=", session.workspace.id)
        .where("entity_type", "=", "store")
        .executeTakeFirstOrThrow();
      assertWithinLimit(session.workspace.plan, "tracked_shops", n);
    }
    await trx.insertInto("watchlists").values({ workspace_id: session.workspace.id, entity_type: entityType, entity_id: String(entityId), added_by: session.user.id }).execute();
    return { watching: true };
  }).catch((e) => {
    if (e instanceof LimitExceededError) return { error: e.message };
    throw e;
  });
  if ("error" in result) return { ok: false, error: "limit", message: result.error };
  await db
    .insertInto("audit_logs")
    .values({ workspace_id: session.workspace.id, actor_id: session.user.id, action: result.watching ? "watchlist.add" : "watchlist.remove", target_type: entityType, target_id: String(entityId) })
    .execute();
  revalidatePath("/brandtracker");
  return { ok: true, watching: result.watching };
}
