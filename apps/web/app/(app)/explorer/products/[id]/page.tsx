import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Eye, Factory, Heart, History, Info, Megaphone, Play, Sparkles, Star, Store, TrendingUp, Truck, Video } from "lucide-react";
import type { Phase, SignalBreakdown } from "@trendscope/core";
import { AreaChart } from "@/components/charts";
import { MarginCalculator } from "@/components/product/margin-calculator";
import { Badge, DeltaBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Flag, Thumb } from "@/components/ui/misc";
import { Meter, PhaseBadge, ScoreRing, scoreTone } from "@/components/ui/score";
import { Tooltip } from "@/components/ui/tooltip";
import { WatchButton } from "@/components/watch-button";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate";
import { NICHE_EMOJI } from "@/lib/niches";
import { cn, daysBetween, formatCompact, formatMoney } from "@/lib/utils";
import { getProduct } from "@/server/queries/products";

export const metadata = { title: "Product" };

const GROUP_COLOR: Record<SignalBreakdown["group"], string> = {
  supply: "var(--chart-2)",
  demand: "var(--chart-1)",
  transactions: "var(--chart-3)",
  economics: "var(--chart-4)",
};

function ScoreCard({ title, hint, value, children }: { title: string; hint: string; value: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Card className="p-5">
      <p className="flex items-center gap-1.5 text-sm text-fg-muted">
        {title}
        <Tooltip content={hint}>
          <Info className="size-3.5 cursor-help text-fg-subtle" />
        </Tooltip>
      </p>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      {children && <div className="mt-3">{children}</div>}
    </Card>
  );
}

function WhyPanel({ signals, notes, positive, groups, t }: { signals: SignalBreakdown[]; notes: string[]; positive: number; groups: string[]; t: Translator }) {
  const max = Math.max(...signals.map((s) => s.contribution), 1);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Badge tone={positive >= 3 ? "accent" : "warning"}>
          <Check /> {t("products.positiveSignals", { count: positive })}
        </Badge>
        <Badge tone={groups.length >= 2 ? "accent" : "neutral"}>{t("products.independentGroups", { count: groups.length })}</Badge>
        {groups.map((g) => (
          <Badge key={g} tone="outline">
            <span className="size-2 rounded-full" style={{ background: GROUP_COLOR[g as SignalBreakdown["group"]] }} />
            {t(`products.groups.${g as SignalBreakdown["group"]}`)}
          </Badge>
        ))}
      </div>
      <ul className="space-y-3">
        {signals.map((s) => (
          <li key={s.signal} className="grid grid-cols-[150px_1fr_150px] items-center gap-4">
            <div className="flex items-center gap-2">
              <span className={cn("grid size-5 place-items-center rounded-full", s.positive ? "bg-accent text-accent-fg" : "bg-bg-subtle text-fg-subtle")}>
                {s.positive ? <Check className="size-3" strokeWidth={3} /> : <span className="size-1.5 rounded-full bg-current" />}
              </span>
              <span className={cn("text-sm font-medium", !s.positive && "text-fg-muted")}>{t(`signals.${s.signal}`)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-bg-subtle">
              <div className="h-full rounded-full transition-all" style={{ width: `${(s.contribution / max) * 100}%`, background: GROUP_COLOR[s.group], opacity: s.positive ? 1 : 0.35 }} />
            </div>
            <div className="tabular flex items-center justify-end gap-2 text-sm">
              {s.signal === "price" ? (
                <span className="text-fg-muted">{Math.round(s.latest * 100)}% {t("products.col.margin").toLowerCase()}</span>
              ) : (
                <>
                  <span className="text-xs text-fg-subtle">7d</span>
                  <DeltaBadge value={s.growth_7d} />
                  <span className="text-xs text-fg-subtle">30d</span>
                  <DeltaBadge value={s.growth_30d} />
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {notes.length > 0 && (
        <div className="space-y-2">
          {notes.map((n) => (
            <p
              key={n}
              className={cn(
                "flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm",
                n === "convergence_bonus" ? "bg-accent-soft text-accent-strong" : "bg-warning-soft text-[#92400e] dark:text-warning",
              )}
            >
              {n === "convergence_bonus" ? <Sparkles className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
              {t(`products.notes.${n as "convergence_bonus"}`)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const t = await getT();
  const data = await getProduct(Number(id), session.workspace.id);
  if (!data) notFound();
  const { cluster: c } = data;
  const L = t.locale;
  const b = c.breakdown;

  // Signalen als index (eerste week = 100), zodat bronnen met verschillende schalen vergelijkbaar zijn
  const indexSeries = [...data.signals.entries()]
    .filter(([source]) => source !== "price")
    .map(([source, points]) => {
      const baseVals = points.slice(0, 7).map((p) => p[1]);
      const base = baseVals.reduce((a, v) => a + v, 0) / Math.max(1, baseVals.length) || 1;
      return { name: t(`signals.${source as "store"}`), points: points.map(([d, v]) => [d, Math.round((v / base) * 100)] as [string, number]) };
    });

  const cheapest = data.offers[0];
  const medianPrice = data.stores.length ? data.stores.map((s) => s.price ?? 0).sort((a, z) => a - z)[Math.floor(data.stores.length / 2)]! : c.min_price ?? 30;

  return (
    <div className="animate-rise">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Link href="/explorer/products" className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> {t("shop.back")}
          </Link>
          <div className="flex min-w-0 items-center gap-3.5">
            <Thumb src={c.image_url} alt={c.canonical_title} className="size-12" />
            <div className="min-w-0">
              <h1 className="truncate text-lg leading-tight font-semibold tracking-tight">{c.canonical_title}</h1>
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <span>
                  {NICHE_EMOJI[c.niche_slug ?? ""]} {L === "nl" ? c.name_nl : c.name_en}
                </span>
                · <span>{c.category}</span>
                {c.is_curated && <Badge tone="accent">★ {t("products.winning")}</Badge>}
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <PhaseBadge phase={c.phase as Phase} label={t(`phases.${c.phase}`)} className="h-8 px-3 text-sm" />
            <WatchButton entityType="product_cluster" entityId={c.id} initial={data.watching} labels={{ track: t("products.track"), tracking: t("shop.tracking") }} />
          </div>
        </div>
      </header>

      <div className="space-y-5 bg-bg-subtle/60 p-6">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <Card className="flex items-center gap-5 p-5">
            <ScoreRing value={c.opportunity} size={84} stroke={7} />
            <div>
              <p className="flex items-center gap-1.5 text-sm text-fg-muted">
                {t("scores.opportunity")}
                <Tooltip content={t("scores.opportunityHint")}>
                  <Info className="size-3.5 cursor-help text-fg-subtle" />
                </Tooltip>
              </p>
              <p className="mt-1 text-sm text-fg-muted">
                {t("products.supplyLine", { stores: b.supply.stores, advertisers: b.supply.advertisers })}
              </p>
            </div>
          </Card>
          <ScoreCard title={t("scores.validation")} hint={t("scores.validationHint")} value={<span className="tabular" style={{ color: scoreTone(c.validation) }}>{Math.round(c.validation)}</span>}>
            <Meter value={c.validation} />
          </ScoreCard>
          <ScoreCard title={t("scores.saturation")} hint={t("scores.saturationHint")} value={<span className="tabular">{Math.round(c.saturation * 100)}%</span>}>
            <Meter value={c.saturation * 100} invert />
          </ScoreCard>
          <ScoreCard title={t("scores.growth")} hint={t("scores.growthHint")} value={<DeltaBadge value={c.growth_velocity} className="h-8 rounded-lg px-2.5 text-xl" />}>
            <p className="text-sm text-fg-muted">
              7d {t("products.groups.demand").toLowerCase()}: <span className="font-semibold text-fg">{b.demand_growth_7d > 0 ? "+" : ""}{b.demand_growth_7d}%</span>
            </p>
          </ScoreCard>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.15fr_1fr]">
          <Card>
            <CardHeader icon={<Sparkles className="!text-accent" />} title={t("products.whyTitle")} hint={t("products.whyHint")} action={<span className="text-xs text-fg-subtle">v{c.weights_version}</span>} />
            <CardBody>
              <WhyPanel signals={b.signals} notes={b.notes} positive={b.positive_signals} groups={b.positive_groups} t={t} />
            </CardBody>
          </Card>
          <div className="grid gap-5">
            <Card>
              <CardHeader icon={<TrendingUp />} title={t("products.signalsTitle")} hint="Index (week 1 = 100)" />
              <CardBody>
                <AreaChart series={indexSeries} locale={L} height={230} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader icon={<History />} title={t("products.scoreHistory")} />
              <CardBody>
                <AreaChart
                  locale={L}
                  height={180}
                  series={[
                    { name: t("scores.opportunity"), points: data.history.map((h) => [h.d, Number(h.opportunity)]), color: "accent" },
                    { name: t("scores.validation"), points: data.history.map((h) => [h.d, Number(h.validation)]), color: "c2" },
                    { name: t("scores.saturation"), points: data.history.map((h) => [h.d, Number(h.saturation)]), color: "c5" },
                  ]}
                />
              </CardBody>
            </Card>
          </div>
        </div>

        {/* Leveranciers + marge */}
        <Card>
          <CardHeader icon={<Factory />} title={t("products.suppliersTitle")} />
          <CardBody className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {data.offers.map((o) => {
                const [lo, hi] = (o.shipping_days ?? "[0,0)").replace(/[[\]()]/g, "").split(",").map(Number);
                return (
                  <li key={o.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="grid size-9 place-items-center rounded-xl bg-bg-subtle text-xs font-bold uppercase">{o.source.slice(0, 2)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{o.name}</p>
                      <p className="flex items-center gap-2 text-xs text-fg-muted">
                        <Star className="size-3 fill-warning text-warning" /> {o.rating} · <Truck className="size-3" /> {t("products.deliveryDays", { min: lo ?? 0, max: (hi ?? 1) - 1 })} · {t("products.orders", { count: o.orders ?? 0 })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular text-sm font-semibold">{formatMoney(o.price, o.currency, L)}</p>
                      <p className="text-xs text-fg-subtle">+ {formatMoney(o.shipping_cost, o.currency, L)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div>
              <p className="mb-3 text-sm font-semibold">{t("products.calculator")}</p>
              <MarginCalculator salePrice={Number(medianPrice.toFixed(2))} productCost={cheapest ? Number((cheapest.price * 0.92).toFixed(2)) : 5} shippingCost={cheapest ? Number((cheapest.shipping_cost * 0.92).toFixed(2)) : 3} />
            </div>
          </CardBody>
        </Card>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader icon={<Store />} title={t("products.storesSelling")} action={<Badge>{c.store_count}</Badge>} />
            <ul className="divide-y divide-border border-t border-border">
              {data.stores.map((s) => (
                <li key={`${s.id}-${s.price}`}>
                  <Link href={`/explorer/shops/${s.id}`} className="flex items-center gap-3.5 px-5 py-3 transition hover:bg-surface-hover">
                    <Thumb src={s.screenshot_url} alt={s.name ?? ""} className="h-10 w-16" rounded="rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {s.name} <Flag country={s.country} className="ml-1 text-[13px]" />
                      </p>
                      <p className="truncate text-xs text-fg-muted">{s.domain} · match {Math.round(s.confidence * 100)}% ({s.method})</p>
                    </div>
                    <div className="text-right">
                      <p className="tabular text-sm font-semibold">{formatMoney(s.price, s.currency ?? "EUR", L)}</p>
                      <p className="text-xs text-fg-muted">{formatCompact(s.monthly_visits, L)} visits</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <div className="grid gap-5">
            <Card>
              <CardHeader icon={<Megaphone />} title={t("products.adsTitle")} action={<Badge>{c.ad_count}</Badge>} />
              <CardBody className="grid grid-cols-4 gap-3">
                {data.ads.map((a) => (
                  <div key={a.id} className="relative">
                    <Thumb src={a.thumbnail_url} alt={a.headline ?? ""} className="aspect-[4/5] w-full" />
                    {a.format === "video" && <Play className="absolute top-1.5 right-1.5 size-5 rounded-full bg-black/50 p-1 text-white" fill="currentColor" />}
                    <span className={cn("absolute top-1.5 left-1.5 rounded px-1 text-[10px] font-semibold", a.is_active ? "bg-accent text-accent-fg" : "bg-black/60 text-white")}>
                      {daysBetween(a.start_date ?? new Date(), a.end_date ?? new Date())}d
                    </span>
                    <p className="mt-1 truncate text-[11px] text-fg-muted">{a.advertiser}</p>
                  </div>
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHeader icon={<Video />} title={t("products.creatorsTitle")} action={<Badge>{c.creator_count}</Badge>} />
              <CardBody className="grid grid-cols-3 gap-3">
                {data.videos.map((v) => (
                  <div key={v.id} className="overflow-hidden rounded-xl border border-border">
                    <div className="relative">
                      <Thumb src={v.thumbnail_url} alt="" className="aspect-[9/12] w-full border-0" rounded="rounded-none" />
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 pt-6 pb-1.5 text-[11px] font-semibold text-white">
                        <span className="flex items-center gap-1"><Eye className="size-3" /> {formatCompact(Number(v.views), L)}</span>
                        <span className="flex items-center gap-1"><Heart className="size-3" /> {formatCompact(Number(v.likes), L)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-2">
                      <Thumb src={v.avatar_url} alt={v.handle} className="size-6 border-0" rounded="rounded-full" />
                      <span className="truncate text-xs font-medium">@{v.handle}</span>
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader icon={<Sparkles />} title={t("products.similar")} />
          <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2 xl:grid-cols-5">
            {data.similar.map((s) => (
              <Link key={s.id} href={`/explorer/products/${s.id}`} className="flex items-center gap-3 bg-surface p-4 transition hover:bg-surface-hover">
                <Thumb src={s.image_url} alt={s.canonical_title} className="size-12" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{s.canonical_title}</p>
                  <PhaseBadge phase={s.phase as Phase} label={t(`phases.${s.phase as Phase}`)} className="mt-1" />
                </div>
                <ScoreRing value={s.opportunity} size={38} />
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
