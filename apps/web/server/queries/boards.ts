import "server-only";
import { getDb, sql } from "@trendscope/db";
import { parseEstimate } from "@trendscope/core";
import { mediaUrl, type MediaItem } from "./ads";

export async function listBoards(workspaceId: string) {
  const db = getDb();
  const boards = await db
    .selectFrom("boards as b")
    .select(["b.id", "b.name", "b.description", "b.color", "b.updated_at", sql<number>`(select count(*)::int from board_items i where i.board_id = b.id)`.as("items")])
    .where("b.workspace_id", "=", workspaceId)
    .orderBy("b.updated_at", "desc")
    .execute();
  const covers = boards.length
    ? await db
        .selectFrom("board_items as i")
        .innerJoin("ads as a", (j) => j.on("i.entity_type", "=", "ad").onRef(sql`a.id`, "=", sql`i.entity_id`))
        .select(["i.board_id", "a.media", "a.thumbnail_url"])
        .where("i.board_id", "in", boards.map((b) => b.id))
        .orderBy("i.added_at", "desc")
        .execute()
    : [];
  return boards.map((b) => ({
    ...b,
    covers: covers.filter((c) => c.board_id === b.id).slice(0, 4).map((c) => mediaUrl((c.media as unknown as MediaItem[])[0]) ?? c.thumbnail_url),
  }));
}

export async function getBoard(id: string, workspaceId: string) {
  const db = getDb();
  const board = await db.selectFrom("boards").selectAll().where("id", "=", id).where("workspace_id", "=", workspaceId).executeTakeFirst();
  if (!board) return null;
  const items = await db
    .selectFrom("board_items as i")
    .leftJoin("users as u", "u.id", "i.added_by")
    .select(["i.entity_type", "i.entity_id", "i.note", "i.tags", "i.added_at", "u.email as added_by"])
    .where("i.board_id", "=", id)
    .orderBy("i.added_at", "desc")
    .execute();
  const adIds = items.filter((i) => i.entity_type === "ad").map((i) => i.entity_id);
  const ads = adIds.length
    ? await db
        .selectFrom("ads as a")
        .innerJoin("advertisers as v", "v.id", "a.advertiser_id")
        .select([
          "a.id", "a.platform", "a.format", "a.headline", "a.body", "a.media", "a.thumbnail_url", "a.is_active", "a.start_date",
          "a.end_date", "a.variants_count", "a.est_reach", "v.name as advertiser",
          sql<number>`(coalesce(a.end_date, current_date) - a.start_date)`.as("days"),
        ])
        .where("a.id", "in", adIds)
        .execute()
    : [];
  return {
    board,
    items: items.map((i) => {
      const ad = ads.find((a) => a.id === i.entity_id);
      return {
        ...i,
        ad: ad ? { ...ad, thumb: mediaUrl((ad.media as unknown as MediaItem[])[0]) ?? ad.thumbnail_url, est_reach: parseEstimate(ad.est_reach) } : null,
      };
    }),
    tags: [...new Set(items.flatMap((i) => i.tags))].sort(),
  };
}
