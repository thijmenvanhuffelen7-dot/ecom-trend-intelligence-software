import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft, Globe, Megaphone, Sparkles } from "lucide-react";
import type { Phase } from "@trendscope/core";
import { AdCard } from "@/components/ads/ad-card";
import { PlatformBadge } from "@/components/ads/platform-icon";
import { AreaChart, DonutChart } from "@/components/charts";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Flag, ShopThumb, Thumb } from "@/components/ui/misc";
import { PhaseBadge, ScoreRing } from "@/components/ui/score";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { formatCompact, formatDate, formatNumber } from "@/lib/utils";
import { getAdvertiser, parseAdFilters, searchAds } from "@/server/queries/ads";

export const metadata = { title: "Advertiser" };

export default async function AdvertiserPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const t = await getT();
  const L = t.locale;
  const data = await getAdvertiser(Number(id));
  if (!data) notFound();
  const { adv } = data;
  const ads = await searchAds({ ...parseAdFilters({ advertiser: id, sort: "newest" }) });
  const countryName = new Intl.DisplayNames([L], { type: "region" });
  const totalCountries = data.countries.reduce((a, c) => a + c.n, 0) || 1;

  const kpis: [string, string][] = [
    [t("advertiser.activeAds"), formatNumber(adv.active_ads, L)],
    [t("advertiser.newAds7d"), formatNumber(adv.new_ads_7d, L)],
    [t("advertiser.totalAds"), formatNumber(adv.total_ads, L)],
    [t("advertiser.euReach"), Number(adv.eu_reach_total) ? formatCompact(Number(adv.eu_reach_total), L) : "—"],
    [t("advertiser.firstAd"), formatDate(adv.first_ad_at, L)],
  ];

  return (
    <div className="animate-rise">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Link href="/explorer/advertisers" className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> {t("advertiser.back")}
          </Link>
          <div className="flex items-center gap-3">
            {adv.avatar_url ? <Thumb src={adv.avatar_url} alt="" className="size-11 border-0" rounded="rounded-full" /> : <div className="grid size-11 place-items-center rounded-full bg-fg font-bold text-bg">{adv.name.slice(0, 1)}</div>}
            <div>
              <h1 className="text-lg leading-tight font-semibold tracking-tight">{adv.name}</h1>
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <PlatformBadge platform={adv.platform} /> {t(`adDetail.source.${adv.platform as "meta"}`)}
              </p>
            </div>
          </div>
          {adv.store_id_ && (
            <Link href={`/explorer/shops/${adv.store_id_}`} className="ml-auto flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2 shadow-sm hover:bg-surface-hover">
              <ShopThumb src={adv.screenshot_url} name={adv.store_name ?? adv.domain ?? ""} color={adv.brand_color} className="h-8 w-12" rounded="rounded-md" />
              <span className="text-sm font-medium">{adv.domain}</span>
            </Link>
          )}
        </div>
      </header>
      <div className="space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
          {kpis.map(([k, v]) => (
            <Card key={k} className="p-4">
              <p className="text-sm text-fg-muted">{k}</p>
              <p className="tabular mt-1 text-2xl font-semibold tracking-tight">{v}</p>
            </Card>
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader icon={<Activity />} title={t("advertiser.activity")} />
            <CardBody>
              <AreaChart
                locale={L}
                height={240}
                series={[
                  { name: t("advertiser.activeAds"), points: data.activity.map((a) => [a.d, a.active] as [string, number]), color: "c2" },
                  { name: t("advertiser.started"), points: data.activity.map((a) => [a.d, a.started] as [string, number]), color: "accent" },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<Globe />} title={t("advertiser.countries")} />
            <CardBody className="space-y-3">
              {data.countries.slice(0, 6).map((c) => (
                <div key={c.country}>
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <Flag country={c.country} /> {countryName.of(c.country)}
                    </span>
                    <span className="tabular text-fg-muted">{c.n}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg-subtle">
                    <div className="h-full rounded-full bg-info" style={{ width: `${(c.n / totalCountries) * 100}%` }} />
                  </div>
                </div>
              ))}
              {data.formats.length > 0 && (
                <div className="grid grid-cols-[110px_1fr] items-center gap-3 pt-2">
                  <DonutChart locale={L} height={110} data={data.formats.map((f) => ({ name: t(`ads.formats.${(f.format ?? "text") as "text"}`), value: f.n }))} />
                  <ul className="space-y-1 text-sm">
                    {data.formats.map((f) => (
                      <li key={f.format} className="flex justify-between text-fg-muted">
                        {t(`ads.formats.${(f.format ?? "text") as "text"}`)} <span className="tabular font-semibold text-fg">{f.n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
        {data.products.length > 0 && (
          <Card className="overflow-hidden">
            <CardHeader icon={<Sparkles className="!text-accent" />} title={t("advertiser.topProducts")} />
            <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
              {data.products.map((p) => (
                <Link key={p.id} href={`/explorer/products/${p.id}`} className="flex items-center gap-3 bg-surface p-4 hover:bg-surface-hover">
                  <Thumb src={p.image_url} alt="" className="size-12" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{p.canonical_title}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
                      {p.phase && <PhaseBadge phase={p.phase as Phase} label={t(`phases.${p.phase as Phase}`)} />}
                      {p.ads} ads
                    </div>
                  </div>
                  {p.opportunity != null && <ScoreRing value={p.opportunity} size={38} />}
                </Link>
              ))}
            </div>
          </Card>
        )}
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
            <Megaphone className="size-4 text-fg-muted" /> {t("advertiser.ads")} <span className="text-fg-subtle">{ads.total}</span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {ads.rows.map((a) => (
              <AdCard key={a.id} t={t} ad={a} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
