import { Layers, AppWindow, CalendarDays, Code2, Coins, Globe, LayoutGrid, LineChart, List, Package, Palette, Rows3, ShoppingBag, Sparkles, Store, TrendingUp, Type, Users } from "lucide-react";
import { ExplorerHeader } from "@/components/explorer/explorer-header";
import { ClearFilters, MoreFilters, MultiFilter, Pagination, RangeFilter, SelectFilter, SortSelect, ViewToggle } from "@/components/explorer/filters";
import { SavedViews } from "@/components/explorer/saved-views";
import { ShopCard, ShopTable } from "@/components/explorer/shop-results";
import { EmptyState } from "@/components/ui/misc";
import { getT } from "@/lib/i18n/server";
import { requireSession } from "@/lib/auth/server";
import { LimitBanner } from "@/components/billing/limit-banner";
import { consumeSearch } from "@/server/billing/limits";
import { NICHE_EMOJI } from "@/lib/niches";
import { flagEmoji, formatCompact } from "@/lib/utils";
import { activeFilterCount, NEW_LAUNCHES_VIEW, PAGE_SIZE, parseShopFilters, searchShops, shopFacets, SHOP_SORTS } from "@/server/queries/shops";
import type { SearchParams } from "@/server/queries/params";

export const metadata = { title: "Shops" };

const FILTER_PARAMS = ["niche", "origin", "vc", "traffic", "tg", "products", "created", "pixels", "apps", "lang", "theme", "cur", "platform", "ads", "ag", "q", "view"];

export default async function ShopsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const t = await getT();
  const filters = parseShopFilters(sp);
  const searchLimited = !!filters.q && !(await consumeSearch(session));
  if (searchLimited) filters.q = undefined;
  const [facets, result] = await Promise.all([shopFacets(), searchShops(filters)]);
  const nicheNames = Object.fromEntries(facets.niches.map((n) => [n.slug, t.locale === "nl" ? n.name_nl : n.name_en]));
  const countryName = new Intl.DisplayNames([t.locale], { type: "region" });
  const languageName = new Intl.DisplayNames([t.locale], { type: "language" });
  const countryOptions = facets.countries.map((c) => ({ value: c.value, label: countryName.of(c.value) ?? c.value, count: c.count, prefix: <span>{flagEmoji(c.value)}</span> }));
  const layout = sp.layout === "grid" ? "grid" : "list";
  const exportQs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  const nActive = activeFilterCount(filters);

  return (
    <>
      <ExplorerHeader
        count={formatCompact(result.total, t.locale)}
        countLabel={t("explorer.shops").toLowerCase()}
        searchPlaceholder={t("explorer.searchShops")}
        exportHref={`/api/export/shops?${exportQs}`}
        exportLabel={t("explorer.exportCsv")}
        demo={{ label: t("explorer.demoData"), hint: t("explorer.demoDataHint") }}
      />

      <div className="space-y-4 bg-bg-subtle/60 px-6 pt-4 pb-6">
        {searchLimited && <LimitBanner message={t("billing.searchLimit")} cta={t("billing.upgradeCta")} />}
        <SavedViews
          allLabel={t("explorer.allShops")}
          views={[
            { slug: NEW_LAUNCHES_VIEW, label: t("shops.newLaunches"), icon: "sparkles" },
            ...facets.views.map((v) => ({ slug: v.slug, label: t.locale === "nl" ? v.name_nl : v.name_en, icon: v.icon })),
          ]}
        />

        {/* Filterpaneel */}
        <section className="grid gap-0 rounded-2xl border border-border bg-surface shadow-sm lg:grid-cols-[1fr_auto]">
          <div className="p-5">
            <h2 className="mb-3.5 flex items-center gap-2 text-[15px] font-semibold">
              <ShoppingBag className="size-4" /> {t("explorer.shopFilters")}
            </h2>
            <div className="flex flex-wrap items-center gap-2.5">
              <MultiFilter param="vc" label={t("shops.filter.visitorCountries")} icon={<Globe />} options={countryOptions} />
              <MultiFilter param="origin" label={t("shops.filter.origin")} icon={<Globe />} options={countryOptions} />
              <RangeFilter
                param="traffic"
                label={t("shops.filter.traffic")}
                icon={<LineChart />}
                presets={[
                  { label: "< 10K", value: "-10000" },
                  { label: "10K – 100K", value: "10000-100000" },
                  { label: "100K – 1M", value: "100000-1000000" },
                  { label: "> 1M", value: "1000000-" },
                ]}
              />
              <MultiFilter
                param="niche"
                label={t("shops.filter.niche")}
                icon={<Sparkles />}
                options={facets.niches.map((n) => ({ value: n.slug, label: nicheNames[n.slug]!, prefix: <span>{NICHE_EMOJI[n.slug]}</span> }))}
              />
              <RangeFilter
                param="products"
                label={t("shops.filter.productsCount")}
                icon={<Package />}
                presets={[
                  { label: "1 – 10", value: "1-10" },
                  { label: "10 – 25", value: "10-25" },
                  { label: "25 – 100", value: "25-100" },
                  { label: "> 100", value: "100-" },
                ]}
              />
              <SelectFilter
                param="created"
                label={t("shops.filter.created")}
                icon={<CalendarDays />}
                options={(["d30", "d90", "y1", "older"] as const).map((v) => ({ value: v, label: t(`shops.created.${v}`) }))}
              />
              <SelectFilter
                param="tg"
                label={t("shops.filter.trafficGrowth")}
                icon={<TrendingUp />}
                options={[0, 10, 25, 50, 100].map((v) => ({ value: String(v), label: `≥ +${v}%` }))}
              />
              <MultiFilter param="pixels" label={t("shops.filter.pixels")} icon={<Code2 />} options={facets.pixels.map((p) => ({ value: p.value, label: p.value, count: p.count }))} />
              <MultiFilter
                param="lang"
                label={t("shops.filter.language")}
                icon={<Type />}
                options={facets.languages.map((l) => ({ value: l.value, label: languageName.of(l.value) ?? l.value, count: l.count }))}
              />
              <MultiFilter param="theme" label={t("shops.filter.theme")} icon={<Palette />} options={facets.themes.map((p) => ({ value: p.value, label: p.value, count: p.count }))} />
              <MoreFilters moreLabel={t("explorer.moreFilters", { count: 3 })} lessLabel={t("explorer.lessFilters")}>
                <MultiFilter
                  param="platform"
                  label={t("shops.filter.platform")}
                  icon={<Layers />}
                  options={facets.platforms.map((p) => ({ value: p.value, label: p.value[0]!.toUpperCase() + p.value.slice(1), count: p.count }))}
                />
                <MultiFilter param="apps" label={t("shops.filter.apps")} icon={<AppWindow />} options={facets.apps.map((p) => ({ value: p.value, label: p.value, count: p.count }))} />
                <MultiFilter param="cur" label={t("shops.filter.currency")} icon={<Coins />} options={facets.currencies.map((p) => ({ value: p.value, label: p.value, count: p.count }))} />
              </MoreFilters>
              {nActive > 0 && <ClearFilters params={FILTER_PARAMS} label={t("explorer.clearFilters")} />}
            </div>
          </div>
          <div className="border-t border-border p-5 lg:min-w-[380px] lg:border-t-0 lg:border-l">
            <h2 className="mb-3.5 flex items-center gap-2 text-[15px] font-semibold">
              <Users className="size-4 text-info" /> {t("explorer.adFilters")}
            </h2>
            <div className="flex flex-wrap gap-2.5">
              <RangeFilter
                param="ads"
                label={t("shops.filter.activeAds")}
                icon={<Rows3 />}
                presets={[
                  { label: "1 – 10", value: "1-10" },
                  { label: "10 – 100", value: "10-100" },
                  { label: "100 – 1K", value: "100-1000" },
                  { label: "> 1K", value: "1000-" },
                ]}
              />
              <SelectFilter
                param="ag"
                label={t("shops.filter.adsGrowth")}
                icon={<TrendingUp />}
                options={[0, 10, 25, 50, 100].map((v) => ({ value: String(v), label: `≥ +${v}%` }))}
              />
            </div>
          </div>
        </section>

        {/* Sorteren + weergave */}
        <div className="flex items-center justify-between px-1">
          <SortSelect label={t("explorer.sortBy")} options={SHOP_SORTS.map((s) => ({ value: s, label: t(`shops.sort.${s}`) }))} />
          <div className="flex items-center gap-3">
            <span className="text-sm text-fg-muted">{t("explorer.results", { count: result.total })}</span>
            <ViewToggle
              options={[
                { value: "list", icon: <List />, label: "List" },
                { value: "grid", icon: <LayoutGrid />, label: "Grid" },
              ]}
            />
          </div>
        </div>

        {result.rows.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface">
            <EmptyState icon={<Store />} title={t("explorer.noResults")} hint={t("explorer.noResultsHint")} action={<ClearFilters params={FILTER_PARAMS} label={t("explorer.clearFilters")} />} />
          </div>
        ) : layout === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {result.rows.map((row) => (
              <ShopCard key={row.id} row={row} nicheNames={nicheNames} />
            ))}
          </div>
        ) : (
          <ShopTable rows={result.rows} nicheNames={nicheNames} />
        )}

        <Pagination
          page={filters.page}
          total={result.total}
          pageSize={PAGE_SIZE}
          labels={{ prev: t("explorer.prev"), next: t("explorer.next"), page: t("explorer.page", { page: filters.page, total: Math.max(1, Math.ceil(result.total / PAGE_SIZE)) }) }}
        />
      </div>
    </>
  );
}
