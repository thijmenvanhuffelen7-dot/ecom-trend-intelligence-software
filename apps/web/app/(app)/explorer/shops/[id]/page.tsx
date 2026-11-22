import Link from "next/link";
import { PLANS } from "@trendscope/core";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeEuro, CalendarDays, Globe, History, Megaphone, Package, Play, Radar, Sparkles, Star, Users } from "lucide-react";
import { DeltaBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ShopEmailFunnel } from "@/components/shop/email-funnel";
import { EstimateValue } from "@/components/ui/estimate";
import { Flag, Thumb } from "@/components/ui/misc";
import { PhaseBadge, ScoreRing } from "@/components/ui/score";
import { Tabs } from "@/components/ui/tabs";
import { PeriodChart } from "@/components/shop/period-chart";
import { Timeline } from "@/components/shop/timeline";
import { CrawlNowButton } from "@/components/shop/crawl-now";
import { AreaChart, DonutChart } from "@/components/charts";
import { WatchButton } from "@/components/watch-button";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { NICHE_EMOJI } from "@/lib/niches";
import { cn, daysBetween, formatAge, formatCompact, formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { getShop } from "@/server/queries/shop-detail";
import type { Phase } from "@trendscope/core";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Shop #${(await params).id}` };
}

const SOURCE_COLORS = ["var(--chart-1)", "var(--chart-6)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--fg-subtle)"];

function TechTile({ name }: { name: string }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium">
      <span className="grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white" style={{ background: `hsl(${h} 55% 48%)` }}>
        {name.replace(/[^A-Za-z0-9]/g, "").slice(0, 1)}
      </span>
      <span className="truncate">{name}</span>
    </div>
  );
}

function ProductRail({ products, locale, currency }: { products: { id: string; title: string; images: string[]; price: number | null; first_seen: Date; best_seller_rank: number | null }[]; locale: string; currency: string }) {
  return (
    <div className="scroll-area -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
      {products.map((p, i) => (
        <div key={p.id} className="w-[150px] shrink-0">
          <div className="relative">
            <Thumb src={p.images[0]} alt={p.title} className="aspect-square w-full" />
            <span className="absolute top-2 right-2 rounded-md bg-surface/90 px-1.5 text-[11px] font-bold shadow-sm">#{p.best_seller_rank ?? i + 1}</span>
          </div>
          <p className="mt-2 truncate text-sm font-medium" title={p.title}>
            {p.title}
          </p>
          <p className="text-sm font-semibold">{formatMoney(p.price, currency, locale)}</p>
          <p className="text-xs text-fg-subtle">{formatDate(p.first_seen, locale)}</p>
        </div>
      ))}
    </div>
  );
}

export default async function ShopPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const t = await getT();
  if (!/^\d+$/.test(id)) notFound();
  const data = await getShop(Number(id), session.workspace.id, PLANS[session.workspace.plan].dataWindowDays);
  if (!data) notFound();
  const { shop } = data;
  const L = t.locale;
  const canAdmin = session.role !== "member" || session.user.isPlatformAdmin;
  const countryName = new Intl.DisplayNames([L], { type: "region" });
  const languageName = new Intl.DisplayNames([L], { type: "language" });
  const totalVisits = shop.monthly_visits ?? 0;
  const followerTotal = Object.values(shop.social_followers).reduce((a, b) => a + b, 0);
  const sources = Object.entries(shop.traffic_sources).sort((a, b) => b[1] - a[1]);
  const pixels = data.tech.filter((x) => x.type === "pixel");
  const apps = data.tech.filter((x) => ["app", "email", "reviews"].includes(x.type));
  const payments = data.tech.filter((x) => x.type === "payment");

  const meta: [string, React.ReactNode][] = [
    [t("shop.category"), <span key="c">{NICHE_EMOJI[shop.niche_slug ?? ""]} {L === "nl" ? shop.niche_nl : shop.niche_en}</span>],
    [t("shop.country"), <span key="co"><Flag country={shop.country} className="mr-1" />{shop.country ? countryName.of(shop.country) : "—"}</span>],
    [t("shop.language"), shop.languages.map((l) => languageName.of(l)).join(", ")],
    [t("shop.currency"), shop.currency],
    [t("shop.theme"), shop.theme],
  ];

  return (
    <div className="animate-rise">
      {/* Kop */}
      <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-6 py-4">
          <Link href="/explorer/shops" className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> {t("shop.back")}
          </Link>
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-xl text-lg font-bold text-white shadow-sm" style={{ background: shop.brand_color ?? "var(--fg)" }}>
              {shop.name?.slice(0, 1)}
            </div>
            <div>
              <h1 className="text-lg leading-tight font-semibold tracking-tight">{shop.name}</h1>
              <p className="text-sm text-fg-muted">
                {shop.domain} · <CalendarDays className="mb-0.5 inline size-3.5" /> {formatDate(shop.launched_at, L)} ({formatAge(shop.launched_at, L)})
              </p>
            </div>
          </div>
          <dl className="hidden flex-1 items-center justify-center gap-8 xl:flex">
            {meta.map(([k, v]) => (
              <div key={k} className="text-center">
                <dt className="text-xs text-fg-subtle">{k}</dt>
                <dd className="mt-0.5 text-sm font-semibold whitespace-nowrap">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="ml-auto flex items-center gap-3">
            {shop.trustpilot && (
              <div className="text-right">
                <div className="flex items-center justify-end gap-0.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <span key={i} className={cn("grid size-4 place-items-center rounded-[3px]", i <= Math.round(shop.trustpilot!.score) ? "bg-[#00b67a]" : "bg-border-strong")}>
                      <Star className="size-2.5 fill-white text-white" />
                    </span>
                  ))}
                  <span className="ml-1.5 text-sm font-semibold">{shop.trustpilot.score}</span>
                </div>
                <p className="text-xs text-fg-muted">Trustpilot · {t("shop.reviews", { count: shop.trustpilot.reviews })}</p>
              </div>
            )}
            <WatchButton entityType="store" entityId={shop.id} initial={data.watching} labels={{ track: t("shop.track"), tracking: t("shop.tracking") }} />
          </div>
        </div>
      </header>

      <div className="space-y-5 bg-bg-subtle/60 p-6">
        {/* KPI's */}
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <Card className="p-5">
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <Users className="size-4" /> {t("shop.monthlyVisits")}
            </p>
            <p className="tabular mt-2 text-3xl font-semibold tracking-tight">{formatNumber(totalVisits, L)}</p>
            <p className="mt-2 flex items-center gap-2 text-sm text-fg-muted">
              <DeltaBadge value={shop.visits_growth} /> {t("shop.vsLastMonth")}
            </p>
          </Card>
          <Card className="p-5">
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <BadgeEuro className="size-4" /> {t("shop.estRevenue")}
            </p>
            <p className="mt-2 text-[26px] leading-9 font-semibold tracking-tight whitespace-nowrap">
              <EstimateValue estimate={shop.est_revenue} t={t} />
            </p>
            <p className="mt-2 text-sm text-fg-muted">{t("shop.estimate")}</p>
          </Card>
          <Card className="p-5">
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <Megaphone className="size-4" /> {t("shops.liveAds")}
            </p>
            <p className="tabular mt-2 text-3xl font-semibold tracking-tight">{formatNumber(shop.live_ads, L)}</p>
            <p className="mt-2 text-sm text-fg-muted">
              {formatNumber(shop.ads_launched_total, L)} {t("shops.adsLaunched")}
            </p>
          </Card>
          <Card className="p-5">
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <Globe className="size-4" /> {t("shop.socialNetworks")}
            </p>
            <p className="tabular mt-2 text-3xl font-semibold tracking-tight">{formatCompact(followerTotal, L)}</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-fg-muted">
              {Object.entries(shop.social_followers)
                .filter(([, v]) => v > 0)
                .map(([k, v]) => (
                  <span key={k} className="capitalize">
                    {k} <span className="font-semibold text-fg">{formatCompact(v, L)}</span>
                  </span>
                ))}
            </div>
          </Card>
        </div>

        {/* Verkeer + ads */}
        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader title={t("shop.trafficOverTime")} action={<DeltaBadge value={shop.visits_growth} />} />
            <CardBody>
              <PeriodChart locale={L} series={[{ name: t("shop.monthlyVisits"), points: data.visits }]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  {t("shop.liveAdsOverTime")} <span className="tabular text-fg-muted">{formatNumber(shop.live_ads, L)}</span>
                  <span className="size-2 rounded-full bg-accent" />
                </span>
              }
              action={
                <div className="flex items-center gap-2 text-xs text-fg-muted">
                  {(["d7", "d30", "d90"] as const).map((k) => (
                    <span key={k} className="flex items-center gap-1">
                      {k.slice(1)}d <DeltaBadge value={data.liveAdsGrowth[k]} />
                    </span>
                  ))}
                </div>
              }
            />
            <CardBody>
              <PeriodChart locale={L} series={[{ name: t("shops.liveAds"), points: data.liveAds, color: "c2" }]} defaultPeriod="6m" weekly={false} />
            </CardBody>
          </Card>
        </div>

        {/* Landen, bronnen, tech */}
        <div className="grid gap-5 xl:grid-cols-3">
          <Card>
            <CardHeader title={t("shop.trafficByCountry")} hint={t("shop.trafficByCountryHint")} />
            <CardBody className="space-y-3.5">
              {shop.visitor_countries.map((c) => (
                <div key={c.country}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <Flag country={c.country} /> {countryName.of(c.country)}
                    </span>
                    <span className="tabular text-fg-muted">
                      {formatNumber(totalVisits * c.share, L)} <span className="ml-2 font-semibold text-fg">{Math.round(c.share * 100)}%</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg-subtle">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${c.share * 100}%` }} />
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("shop.trafficSources")} />
            <CardBody className="grid grid-cols-[150px_1fr] items-center gap-4">
              <DonutChart locale={L} height={150} data={sources.map(([k, v]) => ({ name: t(`shop.sources.${k as "direct"}`), value: v }))} />
              <ul className="space-y-2 text-sm">
                {sources.map(([k, v], i) => (
                  <li key={k} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-fg-muted">
                      <span className="size-2.5 rounded-[3px]" style={{ background: SOURCE_COLORS[i] }} />
                      {t(`shop.sources.${k as "direct"}`)}
                    </span>
                    <span className="tabular font-semibold">{v.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="pt-5">
              <Tabs
                tabs={[
                  { value: "pixels", label: `${t("shop.pixels")} · ${pixels.length}`, content: <div className="grid grid-cols-2 gap-2">{pixels.map((p) => <TechTile key={p.name} name={p.name} />)}</div> },
                  { value: "apps", label: `${t("shop.apps")} · ${apps.length}`, content: <div className="grid grid-cols-2 gap-2">{apps.map((p) => <TechTile key={p.name} name={p.name} />)}</div> },
                  { value: "pay", label: t("shop.payments"), content: <div className="grid grid-cols-2 gap-2">{payments.map((p) => <TechTile key={p.name} name={p.name} />)}</div> },
                ]}
              />
            </CardBody>
          </Card>
        </div>

        {/* Tijdlijn + crawlstatus (fase 2: store intelligence) */}
        <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
          <Card>
            <CardHeader icon={<History />} title={t("timeline.title")} hint={t("timeline.hint")} />
            <CardBody>
              <Timeline events={data.timeline} currency={shop.currency ?? "EUR"} />
            </CardBody>
          </Card>
          <div className="grid content-start gap-5">
            <Card>
              <CardHeader title={t("timeline.last7d")} />
              <CardBody className="grid grid-cols-3 gap-2 text-center">
                {[
                  [shop.products_added_7d, t("timeline.added7d"), "text-accent-strong"],
                  [shop.products_removed_7d, t("timeline.removed7d"), "text-danger"],
                  [shop.price_changes_7d, t("timeline.prices7d"), "text-info"],
                ].map(([n, label, cls]) => (
                  <div key={String(label)} className="rounded-xl bg-bg-subtle py-3">
                    <p className={cn("tabular text-2xl font-semibold", String(cls))}>{n}</p>
                    <p className="text-xs text-fg-muted">{label}</p>
                  </div>
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                icon={<Radar />}
                title={t("crawl.status")}
                action={canAdmin && data.crawl ? <CrawlNowButton storeId={Number(shop.id)} labels={{ crawlNow: t("crawl.crawlNow"), queued: t("crawl.queued") }} /> : undefined}
              />
              <CardBody>
                <dl className="space-y-2.5 text-sm">
                  {(
                    [
                      [t("crawl.source"), shop.data_source === "crawl" ? t("crawl.crawled") : t("crawl.seed")],
                      [t("crawl.lastCrawled"), shop.last_crawled ? formatDateTime(shop.last_crawled, L) : t("crawl.never")],
                      [t("crawl.nextRun"), data.crawl ? formatDateTime(data.crawl.next_run_at, L) : "—"],
                      [t("crawl.interval"), data.crawl ? t("crawl.hours", { n: Math.round(data.crawl.interval_secs / 3600) }) : "—"],
                      [t("crawl.bestsellers"), shop.bestseller_source ?? "—"],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3">
                      <dt className="text-fg-muted">{k}</dt>
                      <dd className="truncate text-right font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
          </div>
        </div>

        {/* Producten */}
        <Card>
          <CardBody className="pt-5">
            <Tabs
              listClassName="mb-1"
              tabs={[
                { value: "best", label: `${t("shop.bestSales")}`, content: <ProductRail products={data.bestSellers} locale={L} currency={shop.currency ?? "EUR"} /> },
                { value: "latest", label: t("shop.lastPublished"), content: <ProductRail products={data.latestProducts} locale={L} currency={shop.currency ?? "EUR"} /> },
              ]}
            />
            <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
              <Package className="size-4" /> {t("shop.productsTitle", { count: shop.product_count })}
            </p>
          </CardBody>
        </Card>

        {/* Gekoppelde trendproducten — de kern-differentiator */}
        <Card className="overflow-hidden">
          <CardHeader icon={<Sparkles className="!text-accent" />} title={t("shop.linkedProducts")} hint={t("shop.linkedProductsHint")} />
          <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
            {data.linked.map((c) => (
              <Link key={c.id} href={`/explorer/products/${c.id}`} className="flex items-center gap-3 bg-surface p-4 transition hover:bg-surface-hover">
                <Thumb src={c.image_url} alt={c.canonical_title} className="size-14" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.canonical_title}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <PhaseBadge phase={c.phase as Phase} label={t(`phases.${c.phase as Phase}`)} />
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">{t("products.supplyLine", { stores: c.store_count, advertisers: c.ad_count })}</p>
                </div>
                <ScoreRing value={c.opportunity} size={44} />
              </Link>
            ))}
          </div>
        </Card>

        {/* E-mailmarketing en funnel */}
        <ShopEmailFunnel
          storeId={shop.id}
          techs={data.tech.map((x) => x.name)}
          emailsPerWeek={shop.emails_per_week}
          avgDiscount={shop.avg_discount_pct}
          esp={shop.email_esp}
          t={t}
        />

        {/* Ads + volgers */}
        <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader icon={<Megaphone />} title={t("shop.ads")} action={<Link href={`/explorer/ads?shop=${shop.id}`} className="text-sm font-medium text-accent-strong hover:underline">{t("home.seeAll")}</Link>} />
            <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {data.ads.map((a) => (
                <div key={a.id} className="group">
                  <div className="relative">
                    <Thumb src={a.thumbnail_url} alt={a.headline ?? ""} className="aspect-[4/5] w-full" />
                    {a.format === "video" && <Play className="absolute top-2 right-2 size-6 rounded-full bg-black/50 p-1.5 text-white" fill="currentColor" />}
                    <span className={cn("absolute top-2 left-2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", a.is_active ? "bg-accent text-accent-fg" : "bg-black/60 text-white")}>
                      {t("ads.daysRunning", { days: daysBetween(a.start_date ?? new Date(), a.end_date ?? new Date()) })}
                    </span>
                  </div>
                  <p className="mt-1.5 truncate text-xs text-fg-muted">{a.advertiser}</p>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<Users />} title={t("shop.followers")} />
            <CardBody>
              <AreaChart locale={L} height={260} series={data.followers.map((f, i) => ({ name: f.net[0]!.toUpperCase() + f.net.slice(1), points: f.points, color: (["c4", "accent", "c2", "c5"] as const)[i] }))} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

