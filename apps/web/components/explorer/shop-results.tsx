import Link from "next/link";
import { Bookmark, ImageIcon, Megaphone, Play, ShoppingBag } from "lucide-react";
import { DeltaBadge } from "@/components/ui/badge";
import { Flag, FlagStack, Thumb } from "@/components/ui/misc";
import { Sparkline } from "@/components/ui/sparkline";
import { Tooltip } from "@/components/ui/tooltip";
import { getT } from "@/lib/i18n/server";
import { NICHE_EMOJI } from "@/lib/niches";
import { formatAge, formatCompact, formatDate, formatNumber } from "@/lib/utils";
import type { ShopRow } from "@/server/queries/shops";

type VisitorCountry = { country: string; share: number };

function NicheChip({ slug, name }: { slug: string; name: string }) {
  return (
    <span className="inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-border bg-surface px-3 text-sm font-medium whitespace-nowrap">
      <span className="text-[13px]">{NICHE_EMOJI[slug] ?? "✨"}</span>
      <span className="truncate">{name}</span>
    </span>
  );
}

function ShopIdentity({ row, locale }: { row: ShopRow; locale: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Thumb src={row.screenshot_url} alt={row.name ?? row.domain} className="h-[60px] w-[96px]" rounded="rounded-lg" />
        <Flag country={row.country} className="absolute -right-1.5 -bottom-1.5 rounded-full bg-surface p-[1px] text-[14px] shadow-sm" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Link href={`/explorer/shops/${row.id}`} className="truncate text-base font-semibold tracking-tight after:absolute after:inset-0 hover:underline">
            {row.name}
          </Link>
          <Bookmark className="size-4 shrink-0 text-fg-subtle" />
        </div>
        <div className="flex items-center gap-1.5 text-sm text-fg-muted">
          <span className="truncate">{row.domain}</span>
          <ShoppingBag className="size-3.5 shrink-0 text-accent" />
        </div>
        <div className="text-sm whitespace-nowrap text-fg-muted">
          {formatDate(row.launched_at, locale)} · {formatAge(row.launched_at, locale)}
        </div>
      </div>
    </div>
  );
}

export async function ShopTable({ rows, nicheNames }: { rows: ShopRow[]; nicheNames: Record<string, string> }) {
  const t = await getT();
  const head = "px-5 py-3.5 text-left text-sm font-medium text-fg-muted whitespace-nowrap";
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="scroll-area overflow-x-auto">
        <table className="w-full min-w-[1320px] border-collapse">
          <thead className="border-b border-border bg-bg-subtle/50">
            <tr>
              <th className={`${head} w-[340px]`}>{t("shops.col.shop")}</th>
              <th className={`${head} w-[240px] border-l border-border`}>{t("shops.col.niche")}</th>
              <th className={`${head} w-[270px]`}>{t("shops.col.bestSellers")}</th>
              <th className={`${head} w-[250px]`}>{t("shops.col.visits")}</th>
              <th className={`${head} w-[250px]`}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-bold text-info">∞</span> {t("shops.col.meta")}
                </span>
              </th>
              <th className={head}>{t("shops.col.activity")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const vc = (row.visitor_countries as VisitorCountry[]).map((v) => v.country);
              return (
                <tr key={row.id} className="group relative border-b border-border transition-colors last:border-0 hover:bg-bg-subtle/60">
                  <td className="px-5 py-4">
                    <ShopIdentity row={row} locale={t.locale} />
                  </td>
                  <td className="border-l border-border px-5 py-4">
                    <div className="flex flex-col items-start gap-2">
                      {row.niches.map((n) => (
                        <NicheChip key={n} slug={n} name={nicheNames[n] ?? n} />
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex gap-2">
                      {row.bestSellers.map((p) => (
                        <Tooltip key={p.id} content={p.title}>
                          <div className="relative z-10">
                            <Thumb src={p.images[0]} alt={p.title} className="size-[72px]" rounded="rounded-lg" />
                          </div>
                        </Tooltip>
                      ))}
                    </div>
                    <div className="mt-2 text-sm text-fg-muted">
                      <span className="font-semibold text-fg">{row.product_count}</span> {t("shops.products", { count: row.product_count }).replace(/^[\d.,]+\s/, "")}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-[76px] shrink-0 whitespace-nowrap">
                        <div className="tabular text-lg font-semibold">{formatCompact(row.monthly_visits, t.locale)}</div>
                        <FlagStack countries={vc} />
                        <div className="mt-1">
                          <DeltaBadge value={row.visits_growth} />
                        </div>
                      </div>
                      <Sparkline values={row.visitsSeries.map(Number)} width={140} height={46} />
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-[76px] shrink-0 whitespace-nowrap">
                        <div className="tabular flex items-center gap-1.5 text-lg font-semibold">
                          <span className="size-2 rounded-full bg-accent shadow-[0_0_0_3px_rgb(31_185_90/0.2)]" />
                          {formatNumber(row.live_ads, t.locale)}
                        </div>
                        <FlagStack countries={vc} />
                        <div className="mt-1 flex items-center gap-1 text-sm text-fg-muted">
                          <Megaphone className="size-3.5" />
                          <DeltaBadge value={row.ads_growth_30d} />
                        </div>
                      </div>
                      <Sparkline values={row.adsSeries.map(Number)} width={140} height={46} tone="accent" />
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex gap-2">
                      {row.latestAds.slice(0, 2).map((a) => (
                        <div key={a.id} className="relative">
                          <Thumb src={a.thumbnail_url} alt="" className="h-[86px] w-[72px]" rounded="rounded-lg" />
                          {a.format === "video" ? (
                            <Play className="absolute right-1.5 bottom-1.5 size-5 rounded-full bg-white/90 p-1 text-black" fill="currentColor" />
                          ) : (
                            <ImageIcon className="absolute right-1.5 bottom-1.5 size-5 rounded-full bg-white/90 p-1 text-black" />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 text-sm whitespace-nowrap text-fg-muted">
                      <span className="font-semibold text-fg">{formatNumber(row.ads_launched_total, t.locale)}</span> {t("shops.adsLaunched")}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export async function ShopCard({ row, nicheNames }: { row: ShopRow; nicheNames: Record<string, string> }) {
  const t = await getT();
  const locale = t.locale;
  return (
    <Link href={`/explorer/shops/${row.id}`} className="group overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative">
        <Thumb src={row.screenshot_url} alt={row.name ?? row.domain} className="aspect-[16/10] w-full border-0" rounded="rounded-none" />
        <div className="absolute top-3 left-3 flex gap-1.5">
          {row.niches.slice(0, 1).map((n) => (
            <span key={n} className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-black shadow-sm backdrop-blur">
              {NICHE_EMOJI[n]} {nicheNames[n]}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{row.name}</p>
            <p className="truncate text-sm text-fg-muted">
              <Flag country={row.country} className="mr-1 text-[13px]" />
              {row.domain}
            </p>
          </div>
          <DeltaBadge value={row.visits_growth} />
        </div>
        <Sparkline values={row.visitsSeries.map(Number)} width={300} height={48} className="w-full" />
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            [t("shops.col.visits"), formatCompact(row.monthly_visits, locale)],
            [t("shops.liveAds"), formatCompact(row.live_ads, locale)],
            [t("explorer.products"), String(row.product_count)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-bg-subtle py-2">
              <div className="tabular text-[15px] font-semibold">{v}</div>
              <div className="text-[11px] text-fg-muted">{k}</div>
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}
