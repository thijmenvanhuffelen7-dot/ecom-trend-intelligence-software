import Link from "next/link";
import { Package, Radar } from "lucide-react";
import type { Phase } from "@trendscope/core";
import { getDb, sql } from "@trendscope/db";
import { DeltaBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, Flag, ShopThumb, Thumb } from "@/components/ui/misc";
import { PhaseBadge, ScoreRing } from "@/components/ui/score";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { formatCompact, formatNumber } from "@/lib/utils";

export const metadata = { title: "Brandtracker" };

export default async function BrandtrackerPage() {
  const session = await requireSession();
  const t = await getT();
  const L = t.locale;
  const db = getDb();
  const [stores, products] = await Promise.all([
    db
      .selectFrom("watchlists as w")
      .innerJoin("stores as s", "s.id", "w.entity_id")
      .select([
        "s.id", "s.name", "s.domain", "s.country", "s.screenshot_url", "s.monthly_visits", "s.visits_growth", "s.live_ads", "s.ads_growth_30d", "w.created_at",
        "s.products_added_7d as new_products",
        "s.price_changes_7d",
      ])
      .where("w.workspace_id", "=", session.workspace.id)
      .where("w.entity_type", "=", "store")
      .orderBy("w.created_at", "desc")
      .execute(),
    db
      .selectFrom("watchlists as w")
      .innerJoin("product_clusters as c", "c.id", "w.entity_id")
      .innerJoin("scores as s", (j) => j.onRef("s.entity_id", "=", "c.id").on("s.entity_type", "=", "product_cluster"))
      .select(["c.id", "c.canonical_title", "c.image_url", "s.opportunity", "s.phase", "s.growth_velocity"])
      .where("w.workspace_id", "=", session.workspace.id)
      .where("w.entity_type", "=", "product_cluster")
      .orderBy("w.created_at", "desc")
      .execute(),
  ]);

  return (
    <div className="animate-rise">
      <header className="border-b border-border bg-bg px-8 pt-9 pb-7">
        <h1 className="flex items-center gap-3 text-[28px] font-semibold tracking-tight">
          <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-strong">
            <Radar className="size-5" />
          </span>
          {t("brandtracker.title")}
        </h1>
        <p className="mt-2 text-fg-muted">{t("brandtracker.subtitle")}</p>
      </header>
      <div className="space-y-6 bg-bg-subtle/60 p-6">
        {stores.length === 0 && products.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Radar />}
              title={t("brandtracker.empty")}
              hint={t("brandtracker.emptyHint")}
              action={
                <Link href="/explorer/shops" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-fg">
                  {t("brandtracker.browse")}
                </Link>
              }
            />
          </Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {stores.map((s) => (
                <Link key={s.id} href={`/explorer/shops/${s.id}`} className="rounded-2xl border border-border bg-surface p-4 shadow-sm transition hover:shadow-md">
                  <div className="flex items-center gap-3">
                    <ShopThumb src={s.screenshot_url} name={s.name || s.domain} className="h-12 w-20" rounded="rounded-lg" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">
                        {s.name} <Flag country={s.country} className="text-[13px]" />
                      </p>
                      <p className="truncate text-sm text-fg-muted">{s.domain}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                    {[
                      [t("shops.col.visits"), formatCompact(s.monthly_visits, L), s.visits_growth],
                      [t("shops.liveAds"), formatNumber(s.live_ads, L), s.ads_growth_30d],
                      ["+ " + t("explorer.products").toLowerCase() + " 7d", String(s.new_products), null],
                      [t("timeline.prices7d") + " 7d", String(s.price_changes_7d), null],
                    ].map(([k, v, d]) => (
                      <div key={String(k)} className="rounded-xl bg-bg-subtle px-1 py-2.5">
                        <p className="tabular text-[15px] font-semibold">{v}</p>
                        <p className="truncate text-[10.5px] text-fg-muted">{k}</p>
                        {d !== null && <DeltaBadge value={d as number} className="mt-1" />}
                      </div>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
            {products.length > 0 && (
              <Card className="overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 font-semibold">
                  <Package className="size-4 text-fg-muted" /> {t("explorer.products")}
                </div>
                <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
                  {products.map((p) => (
                    <Link key={p.id} href={`/explorer/products/${p.id}`} className="flex items-center gap-3 bg-surface p-4 hover:bg-surface-hover">
                      <Thumb src={p.image_url} alt={p.canonical_title} className="size-12" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{p.canonical_title}</p>
                        <PhaseBadge phase={p.phase as Phase} label={t(`phases.${p.phase as Phase}`)} className="mt-1" />
                      </div>
                      <ScoreRing value={p.opportunity} size={40} />
                    </Link>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
