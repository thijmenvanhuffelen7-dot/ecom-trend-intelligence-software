import Link from "next/link";
import { CalendarClock, ExternalLink, Film, Globe, Layers, MousePointerClick, Play, PlayCircle, Radio } from "lucide-react";
import { ExplorerHeader } from "@/components/explorer/explorer-header";
import { ClearFilters, MultiFilter, Pagination, SelectFilter, SortSelect } from "@/components/explorer/filters";
import { Badge } from "@/components/ui/badge";
import { EstimateValue } from "@/components/ui/estimate";
import { EmptyState, Thumb } from "@/components/ui/misc";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { flagEmoji, formatDate } from "@/lib/utils";
import { AD_PAGE_SIZE, AD_SORTS, adFacets, parseAdFilters, searchAds } from "@/server/queries/ads";
import type { SearchParams } from "@/server/queries/params";

export const metadata = { title: "Ads" };
const FILTER_PARAMS = ["q", "status", "format", "mindays", "country", "cta", "shop"];

export default async function AdsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireSession();
  const sp = await searchParams;
  const t = await getT();
  const f = parseAdFilters(sp);
  const [result, facets] = await Promise.all([searchAds(f), adFacets()]);
  const countryName = new Intl.DisplayNames([t.locale], { type: "region" });
  const active = FILTER_PARAMS.some((p) => sp[p]);

  return (
    <>
      <ExplorerHeader count={String(result.total)} countLabel={t("explorer.ads").toLowerCase()} searchPlaceholder={t("explorer.searchAds")} demo={{ label: t("explorer.demoData"), hint: t("explorer.demoDataHint") }} />
      <div className="space-y-4 bg-bg-subtle/60 px-6 pt-5 pb-6">
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2.5">
            <SelectFilter param="status" label={t("ads.filter.status")} icon={<Radio />} options={[{ value: "active", label: t("ads.filter.active") }, { value: "inactive", label: t("ads.filter.inactive") }]} />
            <MultiFilter param="format" label={t("ads.filter.format")} icon={<Film />} options={(["video", "image", "carousel"] as const).map((v) => ({ value: v, label: t(`ads.formats.${v}`) }))} />
            <SelectFilter param="mindays" label={t("ads.filter.minDays")} icon={<CalendarClock />} options={[7, 14, 30, 60, 90].map((d) => ({ value: String(d), label: `≥ ${d}` }))} />
            <MultiFilter param="country" label={t("ads.filter.country")} icon={<Globe />} options={facets.countries.map((c) => ({ value: c.value, label: countryName.of(c.value) ?? c.value, count: c.count, prefix: <span>{flagEmoji(c.value)}</span> }))} />
            <MultiFilter param="cta" label={t("ads.filter.cta")} icon={<MousePointerClick />} options={facets.ctas.map((c) => ({ value: c.value, label: c.value, count: c.count }))} />
            {active && <ClearFilters params={FILTER_PARAMS} label={t("explorer.clearFilters")} />}
          </div>
        </section>
        <div className="flex items-center justify-between px-1">
          <SortSelect label={t("explorer.sortBy")} options={AD_SORTS.map((s) => ({ value: s, label: t(`ads.sort.${s}`) }))} />
          <span className="text-sm text-fg-muted">{t("explorer.results", { count: result.total })}</span>
        </div>
        {result.rows.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface">
            <EmptyState icon={<PlayCircle />} title={t("explorer.noResults")} hint={t("explorer.noResultsHint")} />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {result.rows.map((a) => (
              <article key={a.id} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition hover:shadow-md">
                <div className="flex items-center gap-2.5 p-3">
                  <div className="grid size-8 place-items-center rounded-full bg-fg text-xs font-bold text-bg">{a.advertiser.slice(0, 1)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{a.advertiser}</p>
                    <p className="text-xs text-fg-muted">{formatDate(a.start_date, t.locale)}</p>
                  </div>
                  <Badge tone={a.is_active ? "accent" : "neutral"}>
                    <span className={`size-1.5 rounded-full ${a.is_active ? "bg-accent" : "bg-fg-subtle"}`} />
                    {a.is_active ? t("ads.filter.active") : t("ads.filter.inactive")}
                  </Badge>
                </div>
                <p className="line-clamp-2 h-[2lh] px-3 mb-3 text-sm text-fg-muted">{a.body?.replace(/\s+/g, " ")}</p>
                <div className="relative">
                  <Thumb src={a.thumbnail_url} alt={a.headline ?? ""} className="aspect-[4/5] w-full border-x-0" rounded="rounded-none" />
                  {a.format === "video" && <Play className="absolute top-3 right-3 size-8 rounded-full bg-black/50 p-2 text-white" fill="currentColor" />}
                  <div className="absolute top-3 left-3 flex gap-1.5">
                    <span className="rounded-md bg-black/65 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur">{t("ads.daysRunning", { days: a.days })}</span>
                    {a.variants_count > 1 && (
                      <span className="flex items-center gap-1 rounded-md bg-black/65 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur">
                        <Layers className="size-3" /> {a.variants_count}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                  <p className="truncate text-sm font-semibold">{a.headline}</p>
                  <span className="shrink-0 rounded-lg bg-bg-subtle px-2 py-1 text-xs font-semibold">{a.cta}</span>
                </div>
                <dl className="grid grid-cols-2 gap-2 p-3 text-xs">
                  <div>
                    <dt className="text-fg-subtle">{t("ads.euReach")}</dt>
                    <dd className="mt-0.5 font-semibold">
                      <EstimateValue estimate={a.est_reach} t={t} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-subtle">{t("ads.estSpend")}</dt>
                    <dd className="mt-0.5 font-semibold">
                      <EstimateValue estimate={a.est_spend} t={t} />
                    </dd>
                  </div>
                </dl>
                <div className="mt-auto flex items-center justify-between border-t border-border px-3 py-2.5 text-xs">
                  <span>{a.countries.slice(0, 4).map((c) => flagEmoji(c.trim())).join(" ")}</span>
                  {a.store_id && (
                    <Link href={`/explorer/shops/${a.store_id}`} className="inline-flex items-center gap-1 font-medium text-accent-strong hover:underline">
                      {t("ads.viewShop")} <ExternalLink className="size-3" />
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        <Pagination page={f.page} total={result.total} pageSize={AD_PAGE_SIZE} labels={{ prev: t("explorer.prev"), next: t("explorer.next"), page: t("explorer.page", { page: f.page, total: Math.max(1, Math.ceil(result.total / AD_PAGE_SIZE)) }) }} />
      </div>
    </>
  );
}
