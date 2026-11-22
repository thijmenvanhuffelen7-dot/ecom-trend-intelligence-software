import "server-only";
import { getDb, sql } from "@trendscope/db";

export const ADMIN_TABS = ["overview", "users", "weights", "flags", "curation"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

export async function adminWorkspaces(q?: string) {
  const db = getDb();
  let query = db
    .selectFrom("workspaces as w")
    .select([
      "w.id", "w.name", "w.slug", "w.plan", "w.billing_status", "w.trial_ends_at", "w.created_at", "w.stripe_customer_id",
      sql<{ id: string; email: string; role: string; is_platform_admin: boolean }[]>`coalesce((
        select json_agg(json_build_object('id', u.id, 'email', u.email, 'role', m.role, 'is_platform_admin', u.is_platform_admin) order by m.role, u.email)
        from memberships m join users u on u.id = m.user_id where m.workspace_id = w.id), '[]')`.as("members"),
      sql<number>`coalesce((select sum(used)::int from usage_counters c where c.workspace_id = w.id and c.period_start >= date_trunc('month', now())::date), 0)`.as("usage_month"),
    ])
    .orderBy("w.created_at", "desc")
    .limit(60);
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    query = query.where((eb) =>
      eb.or([
        eb("w.name", "ilike", like),
        eb("w.slug", "ilike", like),
        eb.exists(eb.selectFrom("memberships as m").innerJoin("users as u", "u.id", "m.user_id").select(sql`1`.as("x")).whereRef("m.workspace_id", "=", "w.id").where("u.email", "ilike", like)),
      ]),
    );
  }
  const [rows, totals] = await Promise.all([
    query.execute(),
    db.selectFrom("workspaces").select(["plan", sql<number>`count(*)::int`.as("n")]).groupBy("plan").execute(),
  ]);
  return { rows, totals };
}

export async function adminWeights() {
  const db = getDb();
  const [versions, backtests] = await Promise.all([
    db
      .selectFrom("score_weights as s")
      .leftJoin("users as u", "u.id", "s.created_by")
      .select(["s.version", "s.weights", "s.is_active", "s.note", "s.created_at", "u.email as created_by"])
      .orderBy("s.version", "desc")
      .limit(20)
      .execute(),
    // Laatste backtest per versie en horizon: zo zie je of een nieuwe versie beter voorspelt
    db
      .selectFrom("backtests")
      .select(["weights_version", "horizon_days", "metrics", "run_at"])
      .distinctOn(["weights_version", "horizon_days"])
      .orderBy("weights_version")
      .orderBy("horizon_days")
      .orderBy("run_at", "desc")
      .execute(),
  ]);
  return { versions, backtests };
}

export async function adminFlags() {
  return getDb().selectFrom("feature_flags").selectAll().orderBy("key").execute();
}

export async function adminCuration(q?: string) {
  const db = getDb();
  const base = db
    .selectFrom("product_clusters as c")
    .leftJoin("scores as s", (j) => j.onRef("s.entity_id", "=", "c.id").on("s.entity_type", "=", "product_cluster"))
    .select(["c.id", "c.canonical_title", "c.image_url", "c.is_curated", "c.store_count", "s.opportunity", "s.validation", "s.phase"]);
  const [curated, candidates] = await Promise.all([
    base.where("c.is_curated", "=", true).orderBy("s.opportunity", (ob) => ob.desc().nullsLast()).limit(50).execute(),
    (q ? base.where("c.canonical_title", "ilike", `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`) : base)
      .where("c.is_curated", "=", false)
      .orderBy("s.opportunity", (ob) => ob.desc().nullsLast())
      .limit(20)
      .execute(),
  ]);
  return { curated, candidates };
}
