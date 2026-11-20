"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, sql } from "@trendscope/db";
import { assertCan } from "@trendscope/core";
import { requireSession } from "@/lib/auth/server";

const EntityType = z.enum(["ad", "product_cluster", "store"]);
const BOARD_COLORS = ["#1fb95a", "#3e63dd", "#f59e0b", "#8e4ec6", "#e5484d", "#12a594"];

async function ownBoard(boardId: string, workspaceId: string) {
  const board = await getDb().selectFrom("boards").select(["id", "name"]).where("id", "=", boardId).where("workspace_id", "=", workspaceId).executeTakeFirst();
  if (!board) throw new Error("Board niet gevonden");
  return board;
}

export async function createBoard(raw: { name: string; description?: string }) {
  const session = await requireSession();
  assertCan(session.role, "watchlist.write");
  const { name, description } = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(300).optional() }).parse(raw);
  const db = getDb();
  const { n } = await db.selectFrom("boards").select(sql<number>`count(*)::int`.as("n")).where("workspace_id", "=", session.workspace.id).executeTakeFirstOrThrow();
  const board = await db
    .insertInto("boards")
    .values({ workspace_id: session.workspace.id, name, description, color: BOARD_COLORS[n % BOARD_COLORS.length], created_by: session.user.id })
    .returning(["id", "name", "color"])
    .executeTakeFirstOrThrow();
  await db.insertInto("audit_logs").values({ workspace_id: session.workspace.id, actor_id: session.user.id, action: "board.create", target_type: "board", target_id: board.id }).execute();
  revalidatePath("/boards");
  return board;
}

export async function toggleBoardItem(raw: { boardId: string; entityType: string; entityId: number }) {
  const session = await requireSession();
  assertCan(session.role, "watchlist.write");
  const input = z.object({ boardId: z.string().uuid(), entityType: EntityType, entityId: z.number().int().positive() }).parse(raw);
  await ownBoard(input.boardId, session.workspace.id);
  const db = getDb();
  const existing = await db
    .selectFrom("board_items")
    .select("board_id")
    .where("board_id", "=", input.boardId)
    .where("entity_type", "=", input.entityType)
    .where("entity_id", "=", String(input.entityId))
    .executeTakeFirst();
  if (existing) {
    await db.deleteFrom("board_items").where("board_id", "=", input.boardId).where("entity_type", "=", input.entityType).where("entity_id", "=", String(input.entityId)).execute();
  } else {
    await db.insertInto("board_items").values({ board_id: input.boardId, entity_type: input.entityType, entity_id: String(input.entityId), added_by: session.user.id }).execute();
  }
  await db.updateTable("boards").set({ updated_at: new Date() }).where("id", "=", input.boardId).execute();
  revalidatePath("/boards");
  revalidatePath(`/boards/${input.boardId}`);
  return { saved: !existing };
}

export async function updateBoardItem(raw: { boardId: string; entityType: string; entityId: number; note?: string; tags?: string[] }) {
  const session = await requireSession();
  const input = z
    .object({
      boardId: z.string().uuid(),
      entityType: EntityType,
      entityId: z.number().int().positive(),
      note: z.string().max(1000).optional(),
      tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).optional(),
    })
    .parse(raw);
  await ownBoard(input.boardId, session.workspace.id);
  await getDb()
    .updateTable("board_items")
    .set({ ...(input.note !== undefined ? { note: input.note } : {}), ...(input.tags ? { tags: [...new Set(input.tags)] } : {}) })
    .where("board_id", "=", input.boardId)
    .where("entity_type", "=", input.entityType)
    .where("entity_id", "=", String(input.entityId))
    .execute();
  revalidatePath(`/boards/${input.boardId}`);
}

export async function deleteBoard(raw: { boardId: string }) {
  const session = await requireSession();
  assertCan(session.role, "watchlist.write");
  const { boardId } = z.object({ boardId: z.string().uuid() }).parse(raw);
  await ownBoard(boardId, session.workspace.id);
  await getDb().deleteFrom("boards").where("id", "=", boardId).execute();
  revalidatePath("/boards");
}

/** Voor het "Opslaan"-menu: alle boards van de workspace + of dit item er al in staat. */
export async function boardsForItem(raw: { entityType: string; entityId: number }) {
  const session = await requireSession();
  const { entityType, entityId } = z.object({ entityType: EntityType, entityId: z.number().int().positive() }).parse(raw);
  return getDb()
    .selectFrom("boards as b")
    .select([
      "b.id", "b.name", "b.color",
      sql<boolean>`exists(select 1 from board_items i where i.board_id = b.id and i.entity_type = ${entityType} and i.entity_id = ${entityId})`.as("saved"),
    ])
    .where("b.workspace_id", "=", session.workspace.id)
    .orderBy("b.updated_at", "desc")
    .execute();
}
