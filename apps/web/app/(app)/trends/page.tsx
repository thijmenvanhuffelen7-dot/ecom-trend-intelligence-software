import Link from "next/link";
import { CalendarDays, Clock, Globe, Hash, LineChart, MessageCircle, Search, Sparkles, Waves } from "lucide-react";
import { PHASES, type Phase } from "@trendscope/core";
import { getDb } from "@trendscope/db";
import { SearchBar } from "@/components/explorer/search-bar";
import { ClearFilters, MultiFilter, SelectFilter, SortSelect } from "@/components/explorer/filters";
import { Badge, DeltaBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, Thumb } from "@/components/ui/misc";
import { Meter, PHASE_COLORS, PhaseBadge } from "@/components/ui/score";
import { Sparkline } from "@/components/ui/sparkline";
import { Tooltip } from "@/components/ui/tooltip";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate";
import { NICHE_EMOJI } from "@/lib/niches";
import { cn } from "@/lib/utils";
import type { SearchParams } from "@/server/queries/params";
import { parseTrendFilters, searchTrends, seasonalCalendar, TREND_COUNTRIES, TREND_PERIODS, TREND_SORTS } from "@/server/queries/trends";

export const metadata = { title: "Trends" };

const TABS = ["keywords", "hashtags", "niches", "seasons"] as const;
type Tab = (typeof TABS)[number];
const FILTER_PARAMS = ["q", "phase", "niche", "country", "period"];

function monthName(m: number, locale: string, style: "short" | "long" = "short") {
  return new Intl.DateTimeFormat(locale, { month: style }).format(new Date(2026, m - 1, 15));
}

async function NichesTab({ t }: { t: Translator }) {
  const rows = await getDb()
    .selectFrom("product_clusters as c")
    .innerJoin("scores as s", (j) => j.onRef("s.entity_id", "=", "c.id").on("s.entity_type", "=", "product_cluster"))
    .innerJoin("niches as n", "n.id", "c.niche_id")
    .select(["n.slug", "n.name_nl", "n.name_en", "c.id", "c.canonical_title", "c.image_url", "s.opportunity", "s.phase"])
    .orderBy("s.opportunity", "desc")
    .execute();
  const niches = [...new Map(rows.map((r) => [r.slug, r])).values()]
    .map((n) => {
      const items = rows.filter((r) => r.slug === n.slug);
      return {
        ...n,
        avg: items.reduce((a, r) => a + r.opportunity, 0) / items.length,
        top: items[0]!,
        mix: PHASES.map((p) => ({ phase: p, n: items.filter((i) => i.phase === p).length })),
        total: items.length,
      };
    })
    .sort((a, b) => b.avg - a.avg);
  return (
    <Card className="overflow-hidden">
      <table className="w-full">
        <thead className="border-b border-border bg-bg-subtle/50 text-left text-sm text-fg-muted">
          <tr>
            <th className="px-5 py-3.5 font-medium">{t("trends.niche")}</th>
            <th className="px-5 py-3.5 font-medium">{t("home.phaseMix")}</th>
            <th className="w-48 px-5 py-3.5 font-medium">{t("trends.avgOpportunity")}</th>
            <th className="px-5 py-3.5 font-medium">{t("trends.topProduct")}</th>
          </tr>
        </thead>
        <tbody>
          {niches.map((n) => (
            <tr key={n.slug} className="border-b border-border last:border-0">
              <td className="px-5 py-4 font-semibold">
                <Link href={`/explorer/products?niche=${n.slug}`} className="hover:underline">
                  <span className="mr-2">{NICHE_EMOJI[n.slug]}</span>
                  {t.locale === "nl" ? n.name_nl : n.name_en}
                </Link>
              </td>
              <td className="px-5 py-4">
                <div className="flex h-2.5 w-56 overflow-hidden rounded-full bg-bg-subtle">
                  {n.mix.map((m) => (
                    <div key={m.phase} title={`${t(`phases.${m.phase}`)}: ${m.n}`} style={{ width: `${(m.n / n.total) * 100}%`, background: PHASE_COLORS[m.phase as Phase] }} />
                  ))}
                </div>
              </td>
              <td className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <Meter value={n.avg} />
                  <span className="tabular w-8 text-right font-semibold">{Math.round(n.avg)}</span>
                </div>
              </td>
              <td className="px-5 py-4">
                <Link href={`/explorer/products/${n.top.id}`} className="flex items-center gap-2.5 hover:underline">
                  <Thumb src={n.top.image_url} alt="" className="size-9" rounded="rounded-lg" />
                  <span className="text-sm font-medium">{n.top.canonical_title}</span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

async function SeasonsTab({ t }: { t: Translator }) {
  const items = await seasonalCalendar();
  const now = new Date().getMonth() + 1;
  return (
    <Card className="p-5">
      <p className="font-semibold">{t("trends.seasonsTitle")}</p>
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">{t("trends.seasonsHint")}</p>
      {items.length === 0 ? (
        <p className="mt-6 text-sm text-fg-muted">{t("trends.noSeasons")}</p>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6" data-testid="season-calendar">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const here = items.filter((k) => k.peak_month === m);
            // "nu voorbereiden": piek over 1–2 maanden
            const prepare = ((m - now + 12) % 12) in { 1: 1, 2: 1 };
            return (
              <div key={m} className={cn("min-h-28 rounded-2xl border border-border p-3", m === now && "border-accent bg-accent-soft/40", prepare && "border-warning/60")}>
                <p className="flex items-center justify-between text-sm font-semibold capitalize">
                  {monthName(m, t.locale, "long")}
                  {prepare && <Clock className="size-3.5 text-warning" />}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {here.map((k) => (
                    <li key={k.id}>
                      <Link href={`/trends/${k.id}`} className="block truncate text-sm hover:underline">
                        {k.term}
                      </Link>
                      <span className="text-xs text-fg-subtle">{t("trends.strength", { pct: Math.round((k.seasonality ?? 0) * 100) })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

async function KeywordsTab({ t, sp, kind }: { t: Translator; sp: SearchParams; kind: "keyword" | "hashtag" }) {
  const f = parseTrendFilters({ ...sp, kind });
  const [rows, niches] = await Promise.all([searchTrends(f), getDb().selectFrom("niches").select(["slug", "name_nl", "name_en"]).orderBy("name_en").execute()]);
  const L = t.locale;
  const active = FILTER_PARAMS.some((p) => sp[p]);
  const head = "px-4 py-3.5 text-left text-sm font-medium text-fg-muted whitespace-nowrap";
  const countryName = new Intl.DisplayNames([L], { type: "region" });
  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        {kind === "keyword" && (
          <SelectFilter param="country" label={t("trends.country")} icon={<Globe />} options={TREND_COUNTRIES.map((c) => ({ value: c, label: countryName.of(c) ?? c }))} />
        )}
        <SelectFilter param="period" label={t("trends.period")} icon={<CalendarDays />} options={TREND_PERIODS.map((p) => ({ value: p, label: t(`trends.periods.${p}`) }))} />
        <MultiFilter param="phase" label={t("products.filter.phase")} icon={<Waves />} options={PHASES.map((p) => ({ value: p, label: t(`phases.${p}`) }))} />
        {kind === "keyword" && (
          <MultiFilter param="niche" label={t("products.filter.niche")} icon={<Sparkles />} options={niches.map((n) => ({ value: n.slug, label: L === "nl" ? n.name_nl : n.name_en, prefix: <span>{NICHE_EMOJI[n.slug]}</span> }))} />
        )}
        {active && <ClearFilters params={FILTER_PARAMS} label={t("explorer.clearFilters")} />}
        <div className="ml-auto">
          <SortSelect label={t("explorer.sortBy")} options={TREND_SORTS.map((s) => ({ value: s, label: t(`trends.sort.${s}`) }))} />
        </div>
      </section>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface">
          <EmptyState icon={<Search />} title={t("explorer.noResults")} hint={t("explorer.noResultsHint")} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <div className="scroll-area overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse" data-testid="trend-table">
              <thead className="border-b border-border bg-bg-subtle/50">
                <tr>
                  <th className={`${head} pl-5`}>{kind === "hashtag" ? t("trends.col.hashtag") : t("trends.col.term")}</th>
                  <th className={head}>
                    <Tooltip content={t("trends.phaseHint")}>
                      <span className="cursor-help">{t("trends.col.phase")}</span>
                    </Tooltip>
                  </th>
                  <th className={head}>{t("trends.col.growth")}</th>
                  <th className={head}>{t("trends.col.trend")}</th>
                  <th className={`${head} text-right`}>
                    <Tooltip content={kind === "hashtag" ? t("trends.usesHint") : t("trends.interestHint")}>
                      <span className="cursor-help">{t("trends.col.interest")}</span>
                    </Tooltip>
                  </th>
                  {kind === "keyword" && <th className={`${head} text-right`}>{t("trends.col.reddit")}</th>}
                  <th className={`${head} text-right`}>{t("trends.col.forecast")}</th>
                  {kind === "keyword" && <th className={`${head} pr-5`}>{t("trends.col.product")}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="group relative border-b border-border last:border-0 hover:bg-bg-subtle/60">
                    <td className="py-3 pr-4 pl-5">
                      <Link href={`/trends/${r.id}`} className="font-semibold after:absolute after:inset-0 hover:underline">
                        {kind === "hashtag" ? `#${r.term}` : r.term}
                      </Link>
                      <p className="text-xs text-fg-muted">
                        {r.niche_slug && (
                          <>
                            {NICHE_EMOJI[r.niche_slug]} {niches.find((n) => n.slug === r.niche_slug)?.[L === "nl" ? "name_nl" : "name_en"]}
                          </>
                        )}
                        {r.peak_month && <span className="ml-2 capitalize">· {t("trends.seasonPeak", { month: monthName(r.peak_month, L) })}</span>}
                      </p>
                    </td>
                    <td className="px-4 py-3">{r.phase ? <PhaseBadge phase={r.phase} label={t(`phases.${r.phase}`)} /> : "—"}</td>
                    <td className="px-4 py-3">
                      <DeltaBadge value={r.growth} />
                    </td>
                    <td className="px-4 py-3">
                      <Sparkline values={r.spark} width={140} height={36} />
                    </td>
                    <td className="tabular px-4 py-3 text-right font-medium">{r.level ?? "—"}</td>
                    {kind === "keyword" && (
                      <td className="tabular px-4 py-3 text-right text-sm">
                        {r.reddit_7d ? (
                          <span className="inline-flex items-center gap-1">
                            <MessageCircle className="size-3.5 text-fg-subtle" /> {r.reddit_7d}
                          </span>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">{r.forecast_30d !== null ? <DeltaBadge value={r.forecast_30d} /> : <span className="text-fg-subtle">—</span>}</td>
                    {kind === "keyword" && (
                      <td className="relative z-10 py-3 pr-5 pl-4 text-sm">
                        {r.product_id ? (
                          <Link href={`/explorer/products/${r.product_id}`} className="hover:underline">
                            {r.product_title}
                          </Link>
                        ) : (
                          <Tooltip content={t("trends.opportunityHint")}>
                            <Badge tone="accent">
                              <Sparkles /> {t("trends.noProduct")}
                            </Badge>
                          </Tooltip>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="px-1 text-xs text-fg-subtle">{t("trends.estimateNote")}</p>
    </div>
  );
}

export default async function TrendsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireSession();
  const sp = await searchParams;
  const t = await getT();
  const tab: Tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : "keywords";
  const icons: Record<Tab, React.ReactNode> = { keywords: <Search />, hashtags: <Hash />, niches: <Sparkles />, seasons: <CalendarDays /> };

  return (
    <div className="animate-rise">
      <header className="border-b border-border bg-bg px-8 pt-9">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-[28px] font-semibold tracking-tight">
              <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-strong">
                <LineChart className="size-5" />
              </span>
              {t("trends.title")}
            </h1>
            <p className="mt-2 text-fg-muted">{tab === "niches" ? t("trends.subtitle") : t("trends.subtitleKeywords")}</p>
          </div>
          {(tab === "keywords" || tab === "hashtags") && (
            <div className="w-80">
              <SearchBar placeholder={t("trends.col.term")} />
            </div>
          )}
        </div>
        <nav className="mt-6 flex gap-1" aria-label="Trends">
          {TABS.map((k) => (
            <Link
              key={k}
              href={k === "keywords" ? "/trends" : `/trends?tab=${k}`}
              aria-current={tab === k ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-2 border-b-2 px-3 pb-3 text-sm font-medium transition [&_svg]:size-4",
                tab === k ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {icons[k]} {t(`trends.tabs.${k}`)}
            </Link>
          ))}
        </nav>
      </header>
      <div className="bg-bg-subtle/60 p-6">
        {tab === "niches" ? <NichesTab t={t} /> : tab === "seasons" ? <SeasonsTab t={t} /> : <KeywordsTab t={t} sp={sp} kind={tab === "hashtags" ? "hashtag" : "keyword"} />}
      </div>
    </div>
  );
}
