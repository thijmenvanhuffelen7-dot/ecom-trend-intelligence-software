import Link from "next/link";
import { ArrowUpRight, Bell, Megaphone, Play, Rocket, Sparkles, Store, Target, Zap } from "lucide-react";
import { PHASES } from "@trendscope/core";
import { BarChart } from "@/components/charts";
import { DeltaBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Flag, ShopThumb, Thumb } from "@/components/ui/misc";
import { Meter, PHASE_COLORS, PhaseBadge, ScoreRing } from "@/components/ui/score";
import { Sparkline } from "@/components/ui/sparkline";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { NICHE_EMOJI } from "@/lib/niches";
import { formatCompact, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { getActivity, getHome } from "@/server/queries/home";

export const metadata = { title: "Home" };

function SeeAll({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-accent-strong hover:underline">
      {label} <ArrowUpRight className="size-3.5" />
    </Link>
  );
}

export default async function HomePage() {
  const session = await requireSession();
  const t = await getT();
  const L = t.locale;
  const [data, activity] = await Promise.all([getHome(session.workspace.niches), getActivity(session.workspace.id)]);
  const hour = Number(new Intl.DateTimeFormat("en", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Amsterdam" }).format(new Date()));
  const greeting = hour < 12 ? t("home.greeting.morning") : hour < 18 ? t("home.greeting.afternoon") : t("home.greeting.evening");
  const name = session.user.name ?? session.user.email.split("@")[0];

  const kpis = [
    { label: t("home.kpi.opportunities"), value: data.kpi.opportunities, icon: Target, href: "/explorer/products?minval=50" },
    { label: t("home.kpi.emerging"), value: data.kpi.emerging, icon: Sparkles, href: "/explorer/products?phase=emerging" },
    { label: t("home.kpi.scalingShops"), value: data.kpi.scaling, icon: Rocket, href: "/explorer/shops?tg=25" },
    { label: t("home.kpi.newAds"), value: data.kpi.new_ads, icon: Megaphone, href: "/explorer/ads?sort=newest" },
  ];

  return (
    <div className="animate-rise">
      <header className="relative overflow-hidden border-b border-border bg-bg px-8 pt-9 pb-7">
        <div className="pointer-events-none absolute -top-24 right-0 h-64 w-[640px] bg-[radial-gradient(closest-side,rgb(31_185_90/0.16),transparent)]" />
        <p className="text-sm font-medium text-accent-strong">{new Intl.DateTimeFormat(L, { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p>
        <h1 className="mt-1 text-[32px] font-semibold tracking-tight">
          {greeting}, <span className="capitalize">{name}</span>
        </h1>
        <p className="mt-1 text-fg-muted">{t("home.subtitle")}</p>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((k) => (
            <Link key={k.label} href={k.href} className="group flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent-strong">
                <k.icon className="size-5" />
              </span>
              <div>
                <p className="tabular text-2xl font-semibold tracking-tight">{formatNumber(k.value, L)}</p>
                <p className="text-sm text-fg-muted">{k.label}</p>
              </div>
              <ArrowUpRight className="ml-auto size-4 text-fg-subtle transition group-hover:text-fg" />
            </Link>
          ))}
        </div>
      </header>

      <div className="grid gap-5 bg-bg-subtle/60 p-6 xl:grid-cols-[1.7fr_1fr]">
        <Card>
          <CardHeader icon={<Zap className="!text-accent" />} title={t("home.topOpportunities")} action={<SeeAll href="/explorer/products" label={t("home.seeAll")} />} />
          <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {data.top.map((p) => (
              <Link key={p.id} href={`/explorer/products/${p.id}`} className="group bg-surface p-4 transition hover:bg-surface-hover">
                <div className="relative">
                  <Thumb src={p.image_url} alt={p.canonical_title} className="aspect-[4/3] w-full" />
                  <div className="absolute top-2.5 left-2.5">
                    <PhaseBadge phase={p.phase} label={t(`phases.${p.phase}`)} className="shadow-sm" />
                  </div>
                  <div className="absolute top-2 right-2 rounded-full bg-surface p-0.5 shadow-md">
                    <ScoreRing value={p.opportunity} size={40} />
                  </div>
                </div>
                <p className="mt-3 truncate font-semibold">{p.canonical_title}</p>
                <div className="mt-1 flex items-center justify-between text-sm text-fg-muted">
                  <span>
                    {NICHE_EMOJI[p.niche_slug ?? ""]} {formatMoney(p.min_price, p.currency, L)}
                  </span>
                  <DeltaBadge value={p.growth_velocity} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-fg-muted">
                  <div>
                    {t("scores.validation")} <span className="font-semibold text-fg">{Math.round(p.validation)}</span>
                    <Meter value={p.validation} className="mt-1" />
                  </div>
                  <div>
                    {t("scores.saturation")} <span className="font-semibold text-fg">{Math.round(p.saturation * 100)}%</span>
                    <Meter value={p.saturation * 100} invert className="mt-1" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Card>

        <div className="grid gap-5">
          <Card>
            <CardHeader icon={<Rocket />} title={t("home.scalingShops")} action={<SeeAll href="/explorer/shops?sort=visits_growth" label={t("home.seeAll")} />} />
            <ul className="divide-y divide-border border-t border-border">
              {data.scaling.map((s) => (
                <li key={s.id}>
                  <Link href={`/explorer/shops/${s.id}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-surface-hover">
                    <ShopThumb src={s.screenshot_url} name={s.name || s.domain} className="h-9 w-14" rounded="rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {s.name} <Flag country={s.country} className="ml-0.5 text-[12px]" />
                      </p>
                      <p className="text-xs text-fg-muted">{formatCompact(s.monthly_visits, L)}/mo</p>
                    </div>
                    <Sparkline values={s.series} width={80} height={30} />
                    <DeltaBadge value={s.visits_growth} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader icon={<Bell />} title={activity.scope === "watched" ? t("activity.watched") : t("activity.market")} />
            {activity.events.length === 0 ? (
              <EmptyState title="" hint={t("home.alertsEmpty")} />
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {activity.events.map((e, i) => (
                  <li key={i}>
                    <Link href={`/explorer/shops/${e.store_id}`} className="flex items-center gap-3 px-5 py-2.5 transition hover:bg-surface-hover">
                      <Thumb src={e.payload.image} alt="" className="size-9" rounded="rounded-lg" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{e.payload.title}</p>
                        <p className="truncate text-xs text-fg-muted">
                          {e.store?.name} · {t(`timeline.events.${e.type as "product_added"}`)}
                        </p>
                      </div>
                      {e.type === "price_changed" ? <DeltaBadge value={e.payload.pct} /> : null}
                      <time className="shrink-0 text-xs text-fg-subtle">{formatDateTime(e.at, L)}</time>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader icon={<Megaphone />} title={t("home.newAds")} action={<SeeAll href="/explorer/ads" label={t("home.seeAll")} />} />
          <CardBody className="grid grid-cols-3 gap-3 md:grid-cols-6">
            {data.newAds.map((a) => (
              <Link key={a.id} href={a.store_id ? `/explorer/shops/${a.store_id}` : "/explorer/ads"} className="group">
                <div className="relative">
                  <Thumb src={a.thumbnail_url} alt={a.headline ?? ""} className="aspect-[4/5] w-full transition group-hover:shadow-md" />
                  {a.format === "video" && <Play className="absolute top-2 right-2 size-5 rounded-full bg-black/50 p-1 text-white" fill="currentColor" />}
                </div>
                <p className="mt-1.5 truncate text-xs font-medium">{a.advertiser}</p>
              </Link>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon={<Store />} title={t("home.risingNiches")} action={<SeeAll href="/trends" label={t("home.seeAll")} />} />
          <CardBody className="space-y-3">
            {data.niches.slice(0, 6).map((n) => (
              <div key={n.slug} className="grid grid-cols-[1fr_120px_40px] items-center gap-3 text-sm">
                <span className="truncate font-medium">
                  {NICHE_EMOJI[n.slug]} {L === "nl" ? n.name_nl : n.name_en}
                </span>
                <Meter value={n.avg_opp} />
                <span className="tabular text-right font-semibold">{Math.round(n.avg_opp)}</span>
              </div>
            ))}
            <div className="pt-2">
              <p className="mb-1 text-xs font-medium text-fg-muted">{t("home.phaseMix")}</p>
              <BarChart
                height={150}
                locale={L}
                data={PHASES.map((p) => ({ name: t(`phases.${p}`), value: data.phases.find((x) => x.phase === p)?.n ?? 0 }))}
                colors={PHASES.map((p) => PHASE_COLORS[p])}
              />
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
