import { CalendarClock, Film, Globe, Layers, MousePointerClick, PlayCircle, Radio } from "lucide-react";
import { AdCard } from "@/components/ads/ad-card";
import { ExplorerHeader } from "@/components/explorer/explorer-header";
import { ClearFilters, MultiFilter, Pagination, SelectFilter, SortSelect } from "@/components/explorer/filters";
import { SavedViews } from "@/components/explorer/saved-views";
import { EmptyState } from "@/components/ui/misc";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { flagEmoji, formatCompact } from "@/lib/utils";
import { AD_PAGE_SIZE, AD_SORTS, adFacets, parseAdFilters, searchAds } from "@/server/queries/ads";
import type { SearchParams } from "@/server/queries/params";

export const metadata = { title: "Ads" };
const FILTER_PARAMS = ["q", "view", "status", "platform", "format", "mindays", "country", "cta", "shop", "advertiser"];

export default async function AdsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireSession();
  const sp = await searchParams;
  const t = await getT();
  const f = parseAdFilters(sp);
  const [result, facets] = await Promise.all([searchAds(f), adFacets()]);
  const countryName = new Intl.DisplayNames([t.locale], { type: "region" });
  const active = FILTER_PARAMS.some((p) => sp[p] && p !== "view");
  const vc = facets.viewCounts;

  return (
    <>
      <ExplorerHeader count={formatCompact(result.total, t.locale)} countLabel={t("explorer.ads").toLowerCase()} searchPlaceholder={t("explorer.searchAds")} demo={{ label: t("explorer.demoData"), hint: t("explorer.demoDataHint") }} />
      <div className="space-y-4 bg-bg-subtle/60 px-6 pt-4 pb-6">
        <SavedViews
          allLabel={t("adViews.all")}
          allIcon="play"
          views={[
            { slug: "long-running", label: t("adViews.long-running"), icon: "crown", count: vc.long_running },
            { slug: "scaling", label: t("adViews.scaling"), icon: "trending-up", count: vc.scaling },
            { slug: "new-this-week", label: t("adViews.new-this-week"), icon: "sparkles", count: vc.new_week },
            { slug: "new-advertisers", label: t("adViews.new-advertisers"), icon: "rocket", count: vc.new_adv },
          ]}
        />
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2.5">
            <MultiFilter param="platform" label={t("ads.filter.platform")} icon={<Layers />} options={facets.platforms.map((p) => ({ value: p.value, label: t(`adDetail.source.${p.value as "meta"}`), count: p.count }))} />
            <SelectFilter param="status" label={t("ads.filter.status")} icon={<Radio />} options={[{ value: "active", label: t("ads.filter.active") }, { value: "inactive", label: t("ads.filter.inactive") }]} />
            <MultiFilter param="format" label={t("ads.filter.format")} icon={<Film />} options={(["video", "image", "carousel", "text"] as const).map((v) => ({ value: v, label: t(`ads.formats.${v}`) }))} />
            <SelectFilter param="mindays" label={t("ads.filter.minDays")} icon={<CalendarClock />} options={[7, 14, 30, 60, 90].map((d) => ({ value: String(d), label: `≥ ${d}` }))} />
            <MultiFilter param="country" label={t("ads.filter.country")} icon={<Globe />} options={facets.countries.map((c) => ({ value: c.value, label: countryName.of(c.value) ?? c.value, count: c.count, prefix: <span>{flagEmoji(c.value)}</span> }))} />
            <MultiFilter param="cta" label={t("ads.filter.cta")} icon={<MousePointerClick />} options={facets.ctas.map((c) => ({ value: c.value, label: c.value, count: c.count }))} />
            {active && <ClearFilters params={FILTER_PARAMS.filter((p) => p !== "view")} label={t("explorer.clearFilters")} />}
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
              <AdCard key={a.id} t={t} ad={{ ...a, thumb: a.thumb, store_id: a.store_id }} />
            ))}
          </div>
        )}
        <Pagination page={f.page} total={result.total} pageSize={AD_PAGE_SIZE} labels={{ prev: t("explorer.prev"), next: t("explorer.next"), page: t("explorer.page", { page: f.page, total: Math.max(1, Math.ceil(result.total / AD_PAGE_SIZE)) }) }} />
      </div>
    </>
  );
}
