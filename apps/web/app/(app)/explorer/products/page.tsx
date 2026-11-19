import Link from "next/link";
import { Activity, Award, Gauge, LayoutGrid, List, Package, Sparkles, Tag, Waves } from "lucide-react";
import { PHASES, type Phase } from "@trendscope/core";
import { ExplorerHeader } from "@/components/explorer/explorer-header";
import { ClearFilters, MultiFilter, Pagination, RangeFilter, SelectFilter, SortSelect, ViewToggle } from "@/components/explorer/filters";
import { Badge, DeltaBadge } from "@/components/ui/badge";
import { EmptyState, Thumb } from "@/components/ui/misc";
import { Meter, PhaseBadge, ScoreRing } from "@/components/ui/score";
import { Sparkline } from "@/components/ui/sparkline";
import { Tooltip } from "@/components/ui/tooltip";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { NICHE_EMOJI } from "@/lib/niches";
import { formatMoney } from "@/lib/utils";
import { getDb } from "@trendscope/db";
import type { SearchParams } from "@/server/queries/params";
import { parseProductFilters, PRODUCT_PAGE_SIZE, PRODUCT_SORTS, searchProducts, type ProductRow } from "@/server/queries/products";
import type { Translator } from "@/lib/i18n/translate";

export const metadata = { title: "Products" };

const FILTER_PARAMS = ["q", "niche", "phase", "minval", "maxsat", "price", "curated"];

function SignalDots({ row, t }: { row: ProductRow; t: Translator }) {
  const signals = row.breakdown.signals;
  return (
    <Tooltip
      content={
        <ul className="space-y-1">
          {signals.map((s) => (
            <li key={s.signal} className="flex items-center justify-between gap-4">
              <span className={s.positive ? "text-white" : "text-white/50"}>{t(`signals.${s.signal}`)}</span>
              <span className="tabular">{s.signal === "price" ? `${Math.round((row.breakdown.margin ?? 0) * 100)}%` : `${s.growth_7d > 0 ? "+" : ""}${s.growth_7d}%`}</span>
            </li>
          ))}
        </ul>
      }
    >
      <span className="relative z-10 inline-flex cursor-help items-center gap-[3px]">
        {signals.map((s) => (
          <span key={s.signal} className={`h-3.5 w-1.5 rounded-full ${s.positive ? "bg-accent" : "bg-border-strong"}`} />
        ))}
        <span className="ml-1.5 text-xs text-fg-muted">{row.breakdown.positive_signals}/{signals.length}</span>
      </span>
    </Tooltip>
  );
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireSession();
  const sp = await searchParams;
  const t = await getT();
  const f = parseProductFilters(sp);
  const [result, niches] = await Promise.all([searchProducts(f), getDb().selectFrom("niches").select(["slug", "name_nl", "name_en"]).orderBy("name_en").execute()]);
  const L = t.locale;
  const nicheName = Object.fromEntries(niches.map((n) => [n.slug, L === "nl" ? n.name_nl : n.name_en]));
  const grid = sp.layout === "grid";
  const active = FILTER_PARAMS.some((p) => sp[p]);
  const head = "px-4 py-3.5 text-left text-sm font-medium text-fg-muted whitespace-nowrap";

  return (
    <>
      <ExplorerHeader count={String(result.total)} countLabel={t("explorer.products").toLowerCase()} searchPlaceholder={t("explorer.searchProducts")} demo={{ label: t("explorer.demoData"), hint: t("explorer.demoDataHint") }} />
      <div className="space-y-4 bg-bg-subtle/60 px-6 pt-5 pb-6">
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2.5">
            <MultiFilter param="niche" label={t("products.filter.niche")} icon={<Sparkles />} options={niches.map((n) => ({ value: n.slug, label: nicheName[n.slug]!, prefix: <span>{NICHE_EMOJI[n.slug]}</span> }))} />
            <MultiFilter param="phase" label={t("products.filter.phase")} icon={<Waves />} options={PHASES.map((p) => ({ value: p, label: t(`phases.${p}`) }))} />
            <SelectFilter param="minval" label={t("products.filter.minValidation")} icon={<Award />} options={[30, 50, 70, 85].map((v) => ({ value: String(v), label: `≥ ${v}` }))} />
            <SelectFilter param="maxsat" label={t("products.filter.maxSaturation")} icon={<Gauge />} options={[20, 35, 50].map((v) => ({ value: String(v), label: `≤ ${v}%` }))} />
            <RangeFilter param="price" label={t("products.filter.price")} icon={<Tag />} presets={[{ label: "< €20", value: "-20" }, { label: "€20 – €40", value: "20-40" }, { label: "€40 – €80", value: "40-80" }, { label: "> €80", value: "80-" }]} />
            <SelectFilter param="curated" label={t("products.filter.curated")} icon={<Activity />} options={[{ value: "1", label: t("products.winning") }]} />
            {active && <ClearFilters params={FILTER_PARAMS} label={t("explorer.clearFilters")} />}
          </div>
        </section>

        <div className="flex items-center justify-between px-1">
          <SortSelect label={t("explorer.sortBy")} options={PRODUCT_SORTS.map((s) => ({ value: s, label: t(`products.sort.${s}`) }))} />
          <ViewToggle options={[{ value: "list", icon: <List />, label: "List" }, { value: "grid", icon: <LayoutGrid />, label: "Grid" }]} />
        </div>

        {result.rows.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface">
            <EmptyState icon={<Package />} title={t("explorer.noResults")} hint={t("explorer.noResultsHint")} action={<ClearFilters params={FILTER_PARAMS} label={t("explorer.clearFilters")} />} />
          </div>
        ) : grid ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            {result.rows.map((r) => (
              <Link key={r.id} href={`/explorer/products/${r.id}`} className="group overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="relative">
                  <Thumb src={r.image_url} alt={r.canonical_title} className="aspect-square w-full border-0" rounded="rounded-none" />
                  <div className="absolute top-3 left-3">
                    <PhaseBadge phase={r.phase as Phase} label={t(`phases.${r.phase as Phase}`)} className="shadow-sm" />
                  </div>
                  <div className="absolute top-2.5 right-2.5 rounded-full bg-surface p-0.5 shadow-md">
                    <ScoreRing value={r.opportunity} size={42} />
                  </div>
                </div>
                <div className="space-y-2 p-4">
                  <p className="truncate font-semibold">{r.canonical_title}</p>
                  <div className="flex items-center justify-between text-sm text-fg-muted">
                    <span>{formatMoney(r.min_price, r.currency, L)}</span>
                    <DeltaBadge value={r.growth_velocity} />
                  </div>
                  <Sparkline values={r.demand} width={260} height={40} className="w-full" />
                  <p className="text-xs text-fg-muted">{t("products.supplyLine", { stores: r.store_count, advertisers: r.ad_count })}</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
            <div className="scroll-area overflow-x-auto">
              <table className="w-full min-w-[1250px] border-collapse">
                <thead className="border-b border-border bg-bg-subtle/50">
                  <tr>
                    <th className={`${head} pl-5`}>{t("products.col.product")}</th>
                    <th className={head}>{t("products.col.opportunity")}</th>
                    <th className={head}>{t("products.col.validation")}</th>
                    <th className={head}>{t("products.col.saturation")}</th>
                    <th className={head}>{t("products.col.growth")}</th>
                    <th className={head}>{t("products.col.phase")}</th>
                    <th className={head}>{t("products.col.trend")}</th>
                    <th className={`${head} text-right`}>{t("products.col.stores")}</th>
                    <th className={`${head} text-right`}>{t("products.col.ads")}</th>
                    <th className={`${head} pr-5 text-right`}>{t("products.col.price")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.id} className="group relative border-b border-border transition-colors last:border-0 hover:bg-bg-subtle/60">
                      <td className="py-3 pr-4 pl-5">
                        <div className="flex items-center gap-3.5">
                          <Thumb src={r.image_url} alt={r.canonical_title} className="size-14" />
                          <div className="min-w-0">
                            <Link href={`/explorer/products/${r.id}`} className="block max-w-[260px] truncate font-semibold after:absolute after:inset-0 hover:underline">
                              {r.canonical_title}
                            </Link>
                            <div className="mt-0.5 flex items-center gap-2 text-sm text-fg-muted">
                              <span>
                                {NICHE_EMOJI[r.niche_slug ?? ""]} {nicheName[r.niche_slug ?? ""]}
                              </span>
                              {r.is_curated && <Badge tone="accent">★ {t("products.winning")}</Badge>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ScoreRing value={r.opportunity} size={44} />
                      </td>
                      <td className="w-40 px-4 py-3">
                        <div className="tabular mb-1.5 text-sm font-semibold">{Math.round(r.validation)}</div>
                        <SignalDots row={r} t={t} />
                      </td>
                      <td className="w-36 px-4 py-3">
                        <div className="tabular mb-1.5 text-sm font-semibold">{Math.round(r.saturation * 100)}%</div>
                        <Meter value={r.saturation * 100} invert />
                      </td>
                      <td className="px-4 py-3">
                        <DeltaBadge value={r.growth_velocity} />
                      </td>
                      <td className="px-4 py-3">
                        <PhaseBadge phase={r.phase as Phase} label={t(`phases.${r.phase as Phase}`)} />
                      </td>
                      <td className="px-4 py-3">
                        <Sparkline values={r.demand} width={130} height={40} />
                      </td>
                      <td className="tabular px-4 py-3 text-right font-medium">{r.store_count}</td>
                      <td className="tabular px-4 py-3 text-right font-medium">{r.ad_count}</td>
                      <td className="tabular py-3 pr-5 pl-4 text-right text-sm font-medium whitespace-nowrap">
                        {formatMoney(r.min_price, r.currency, L)} – {formatMoney(r.max_price, r.currency, L)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <Pagination
          page={f.page}
          total={result.total}
          pageSize={PRODUCT_PAGE_SIZE}
          labels={{ prev: t("explorer.prev"), next: t("explorer.next"), page: t("explorer.page", { page: f.page, total: Math.max(1, Math.ceil(result.total / PRODUCT_PAGE_SIZE)) }) }}
        />
      </div>
    </>
  );
}
