import "server-only";
import { getDb, sql } from "@trendscope/db";
import { AlertRuleSchema, type AlertRule } from "@trendscope/core";
import { chQuery } from "../clickhouse";

/**
 * Evalueert de alertregels van een workspace tegen de actuele data.
 * - Elke treffer krijgt een dedupe-sleutel (entiteit + tijdvak van `cooldown_hours`): binnen de cooldown nooit dubbel.
 * - Max. 20 treffers per regel per ronde, zodat een te ruime regel geen stortvloed veroorzaakt.
 * - Per treffer: een in-app-melding en een bezorging per gekoppeld kanaal (de worker verstuurt die, met retries).
 * Gebruikt door "Nu controleren" in de UI en door de cron-route (/api/cron/alerts).
 */
const MAX_PER_RULE = 20;

export interface Match {
  key: string;
  entityType: "product_cluster" | "store" | "advertiser" | "keyword";
  entityId: string;
  url: string;
  title: { nl: string; en: string };
  facts: Record<string, string | number>;
}

type Db = ReturnType<typeof getDb>;

function watchIds(db: Db, workspaceId: string, type: "product_cluster" | "store" | "advertiser") {
  return db.selectFrom("watchlists").select("entity_id").where("workspace_id", "=", workspaceId).where("entity_type", "=", type);
}

export async function matchesFor(rule: AlertRule, workspaceId: string, db: Db = getDb()): Promise<Match[]> {
  switch (rule.kind) {
    case "score_threshold": {
      let q = db
        .selectFrom("scores as s")
        .innerJoin("product_clusters as c", "c.id", "s.entity_id")
        .leftJoin("niches as n", "n.id", "c.niche_id")
        .select(["c.id", "c.canonical_title", "s.validation", "s.opportunity", "s.growth_velocity", "s.phase"])
        .where("s.entity_type", "=", "product_cluster")
        .where(`s.${rule.metric}`, rule.op === "gt" ? ">" : "<", rule.value);
      if (rule.scope === "watchlist") q = q.where("c.id", "in", watchIds(db, workspaceId, "product_cluster"));
      if (rule.niches.length) q = q.where("n.slug", "in", rule.niches);
      const rows = await q.orderBy(`s.${rule.metric}`, rule.op === "gt" ? "desc" : "asc").limit(MAX_PER_RULE).execute();
      return rows.map((r) => ({
        key: `pc:${r.id}`,
        entityType: "product_cluster",
        entityId: String(r.id),
        url: `/explorer/products/${r.id}`,
        title: {
          nl: `${r.canonical_title}: ${metricNl[rule.metric]} ${Math.round(Number(r[rule.metric]))} (${rule.op === "gt" ? ">" : "<"} ${rule.value})`,
          en: `${r.canonical_title}: ${rule.metric.replace("_", " ")} ${Math.round(Number(r[rule.metric]))} (${rule.op === "gt" ? ">" : "<"} ${rule.value})`,
        },
        facts: { validation: Math.round(r.validation), opportunity: Math.round(r.opportunity), phase: r.phase },
      }));
    }
    case "phase_change": {
      let q = db
        .selectFrom("scores as s")
        .innerJoin("product_clusters as c", "c.id", "s.entity_id")
        .select(["c.id", "c.canonical_title", "s.phase"])
        .where("s.entity_type", "=", "product_cluster")
        .where("s.phase", "in", rule.to);
      if (rule.scope === "watchlist") q = q.where("c.id", "in", watchIds(db, workspaceId, "product_cluster"));
      const rows = await q.limit(500).execute();
      if (!rows.length) return [];
      const prev = await chQuery<{ id: string; phase: string }>(
        `SELECT toString(entity_id) AS id, argMax(phase, date) AS phase FROM score_history FINAL
         WHERE entity_type = 'product_cluster' AND entity_id IN {ids:Array(UInt64)} AND date < (SELECT max(date) FROM score_history)
           AND date >= (SELECT max(date) FROM score_history) - 7
         GROUP BY entity_id`,
        { ids: rows.map((r) => Number(r.id)) },
      );
      const before = new Map(prev.map((p) => [p.id, p.phase]));
      return rows
        .filter((r) => before.has(String(r.id)) && before.get(String(r.id)) !== r.phase)
        .slice(0, MAX_PER_RULE)
        .map((r) => ({
          key: `pc:${r.id}:${r.phase}`,
          entityType: "product_cluster",
          entityId: String(r.id),
          url: `/explorer/products/${r.id}`,
          title: { nl: `${r.canonical_title} is nu ${phaseNl[r.phase]}`, en: `${r.canonical_title} is now ${r.phase}` },
          facts: { from: before.get(String(r.id)) ?? "", to: r.phase },
        }));
    }
    case "store_new_products": {
      let q = db
        .selectFrom("stores as s")
        .select([
          "s.id", "s.name", "s.domain",
          sql<number>`(select count(*)::int from products p where p.store_id = s.id and p.first_seen > now() - make_interval(days => ${rule.days}))`.as("added"),
        ]);
      if (rule.scope === "watchlist") q = q.where("s.id", "in", watchIds(db, workspaceId, "store"));
      else q = q.where("s.products_added_7d", ">=", rule.min);
      const rows = (await q.limit(1000).execute()).filter((r) => r.added >= rule.min).sort((a, b) => b.added - a.added).slice(0, MAX_PER_RULE);
      return rows.map((r) => ({
        key: `st:${r.id}`,
        entityType: "store",
        entityId: String(r.id),
        url: `/explorer/shops/${r.id}`,
        title: { nl: `${r.name ?? r.domain} voegde ${r.added} producten toe in ${rule.days} dagen`, en: `${r.name ?? r.domain} added ${r.added} products in ${rule.days} days` },
        facts: { added: r.added, days: rule.days },
      }));
    }
    case "advertiser_new_ads": {
      let q = db
        .selectFrom("advertisers as a")
        .select([
          "a.id", "a.name", "a.platform",
          sql<number>`(select count(*)::int from ads x where x.advertiser_id = a.id and x.start_date > now() - make_interval(days => ${rule.days}))`.as("started"),
        ]);
      if (rule.scope === "watchlist") q = q.where("a.id", "in", watchIds(db, workspaceId, "advertiser"));
      else q = q.where("a.active_ads", ">=", rule.min);
      const rows = (await q.limit(2000).execute()).filter((r) => r.started >= rule.min).sort((a, b) => b.started - a.started).slice(0, MAX_PER_RULE);
      return rows.map((r) => ({
        key: `adv:${r.id}`,
        entityType: "advertiser",
        entityId: String(r.id),
        url: `/explorer/advertisers/${r.id}`,
        title: { nl: `${r.name} startte ${r.started} nieuwe ads in ${rule.days} dagen`, en: `${r.name} started ${r.started} new ads in ${rule.days} days` },
        facts: { started: r.started, platform: r.platform },
      }));
    }
    case "keyword_growth": {
      const col = rule.window === "7d" ? "growth_7d" : "growth_30d";
      const rows = await db
        .selectFrom("keywords")
        .select(["id", "term", "growth_7d", "growth_30d", "phase"])
        .where("kind", "=", rule.keywordKind)
        .where(col, ">=", rule.pct)
        .orderBy(col, "desc")
        .limit(MAX_PER_RULE)
        .execute();
      return rows.map((r) => ({
        key: `kw:${r.id}`,
        entityType: "keyword",
        entityId: String(r.id),
        url: `/trends/${r.id}`,
        title: {
          nl: `"${r.term}" groeit ${Math.round(Number(r[col]))}% (${rule.window})`,
          en: `"${r.term}" is up ${Math.round(Number(r[col]))}% (${rule.window})`,
        },
        facts: { growth: Math.round(Number(r[col])), phase: r.phase ?? "" },
      }));
    }
    case "competitor_price_drop": {
      const products = await db
        .selectFrom("products as p")
        .innerJoin("stores as s", "s.id", "p.store_id")
        .select(["p.id", "p.title", "p.price", "s.name", "s.id as store_id"])
        .where("p.store_id", "in", watchIds(db, workspaceId, "store"))
        .where("p.status", "!=", "removed")
        .limit(5000)
        .execute();
      if (!products.length) return [];
      const peaks = await chQuery<{ id: string; peak: number }>(
        `SELECT toString(product_id) AS id, max(toFloat64(price)) AS peak FROM product_snapshots
         WHERE product_id IN {ids:Array(UInt64)} AND captured_at > now() - INTERVAL 14 DAY AND price IS NOT NULL GROUP BY product_id`,
        { ids: products.map((p) => Number(p.id)) },
      );
      const peak = new Map(peaks.map((p) => [p.id, Number(p.peak)]));
      return products
        .map((p) => ({ ...p, drop: peak.get(String(p.id)) ? (1 - Number(p.price) / peak.get(String(p.id))!) * 100 : 0 }))
        .filter((p) => p.drop >= rule.pct)
        .sort((a, b) => b.drop - a.drop)
        .slice(0, MAX_PER_RULE)
        .map((p) => ({
          key: `p:${p.id}:${Math.round(Number(p.price) * 100)}`,
          entityType: "store",
          entityId: String(p.store_id),
          url: `/explorer/shops/${p.store_id}`,
          title: { nl: `${p.name}: "${p.title}" ${Math.round(p.drop)}% goedkoper`, en: `${p.name}: "${p.title}" ${Math.round(p.drop)}% cheaper` },
          facts: { drop_pct: Math.round(p.drop), price: Number(p.price) },
        }));
    }
    case "new_store_launch": {
      let q = db
        .selectFrom("stores as s")
        .leftJoin("niches as n", "n.id", "s.niche_id")
        .select(["s.id", "s.name", "s.domain", "s.first_seen"])
        .where("s.first_seen", ">", sql<Date>`now() - interval '7 days'`);
      if (rule.niches.length) q = q.where("n.slug", "in", rule.niches);
      const rows = await q.orderBy("s.first_seen", "desc").limit(MAX_PER_RULE).execute();
      return rows.map((r) => ({
        key: `new:${r.id}`,
        entityType: "store",
        entityId: String(r.id),
        url: `/explorer/shops/${r.id}`,
        title: { nl: `Nieuwe winkel: ${r.name ?? r.domain}`, en: `New store: ${r.name ?? r.domain}` },
        facts: { domain: r.domain },
      }));
    }
  }
}

const metricNl = { validation: "validatie", opportunity: "opportuniteit", growth_velocity: "groei %" } as const;
const phaseNl: Record<string, string> = { emerging: "opkomend", rising: "stijgend", peak: "op de piek", saturated: "verzadigd", declining: "dalend" };

/** Evalueert alle actieve regels van een workspace; geeft het aantal nieuwe meldingen terug. */
export async function evaluateWorkspace(workspaceId: string, now = new Date()): Promise<{ rules: number; events: number }> {
  const db = getDb();
  const rules = await db.selectFrom("alert_rules").selectAll().where("workspace_id", "=", workspaceId).where("enabled", "=", true).execute();
  let events = 0;
  for (const r of rules) {
    const parsed = AlertRuleSchema.safeParse(r.rule);
    if (!parsed.success) continue;
    const matches = await matchesFor(parsed.data, workspaceId, db);
    const bucket = Math.floor(now.getTime() / (r.cooldown_hours * 3_600_000));
    const channels = ((r.channels as string[]) ?? []).filter((c) => /^[0-9a-f-]{36}$/.test(c));
    for (const m of matches) {
      const inserted = await db
        .insertInto("alert_events")
        .values({
          rule_id: r.id,
          workspace_id: workspaceId,
          triggered_at: now,
          dedupe_key: `${m.key}:${bucket}`,
          entity_type: m.entityType,
          entity_id: m.entityId,
          title: m.title.nl,
          payload: JSON.stringify({ rule: r.name, kind: parsed.data.kind, url: m.url, title: m.title, facts: m.facts }),
        })
        .onConflict((oc) => oc.columns(["rule_id", "dedupe_key"]).where("dedupe_key", "is not", null).doNothing())
        .returning("id")
        .executeTakeFirst();
      if (!inserted) continue;
      events++;
      if (channels.length) {
        await db.insertInto("alert_deliveries").values(channels.map((c) => ({ event_id: inserted.id, channel_id: c }))).execute();
      }
    }
    await db
      .updateTable("alert_rules")
      .set({ last_evaluated_at: now, ...(matches.length ? { last_triggered_at: now } : {}) })
      .where("id", "=", r.id)
      .execute();
  }
  return { rules: rules.length, events };
}
