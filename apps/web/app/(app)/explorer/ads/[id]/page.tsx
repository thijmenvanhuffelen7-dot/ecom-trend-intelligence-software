import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, ExternalLink, Globe, Layers, Link2, Megaphone, Sparkles, Users } from "lucide-react";
import type { Phase } from "@trendscope/core";
import { AreaChart } from "@/components/charts";
import { PlatformBadge } from "@/components/ads/platform-icon";
import { SaveToBoard } from "@/components/ads/save-to-board";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EstimateValue } from "@/components/ui/estimate";
import { Flag, ShopThumb, Thumb } from "@/components/ui/misc";
import { PhaseBadge, ScoreRing } from "@/components/ui/score";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { getAd, mediaUrl } from "@/server/queries/ads";

export const metadata = { title: "Ad" };

export default async function AdPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const t = await getT();
  const data = await getAd(Number(id));
  if (!data) notFound();
  const { ad } = data;
  const L = t.locale;
  const media = ad.media[0];
  const src = mediaUrl(media) ?? ad.thumbnail_url;
  const countryName = new Intl.DisplayNames([L], { type: "region" });

  const details: [string, React.ReactNode][] = [
    [t("adDetail.started"), formatDate(ad.start_date, L)],
    [ad.is_active ? t("adDetail.running") : t("adDetail.ended"), ad.is_active ? t("ads.daysRunning", { days: ad.days }) : formatDate(ad.end_date, L)],
    [t("adDetail.platforms"), ad.publisher_platforms.length ? ad.publisher_platforms.join(", ") : "—"],
    [t("adDetail.audience"), [ad.target_ages, ad.target_gender].filter(Boolean).join(" · ") || "—"],
    [t("adDetail.caption"), ad.link_caption ?? "—"],
  ];

  return (
    <div className="animate-rise">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Link href="/explorer/ads" className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> {t("adDetail.back")}
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-lg leading-tight font-semibold tracking-tight">{ad.headline ?? ad.advertiser}</h1>
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <PlatformBadge platform={ad.platform} /> {ad.advertiser} · {t(`adDetail.source.${ad.platform as "meta"}`)}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge tone={ad.is_active ? "accent" : "neutral"}>
              <span className={`size-1.5 rounded-full ${ad.is_active ? "bg-accent" : "bg-fg-subtle"}`} />
              {ad.is_active ? t("ads.filter.active") : t("ads.filter.inactive")}
            </Badge>
            <SaveToBoard entityId={Number(ad.id)} />
          </div>
        </div>
      </header>

      <div className="grid gap-5 p-6 xl:grid-cols-[420px_1fr]">
        {/* Creative */}
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <div className="relative bg-bg-subtle">
              {src ? (
                <Thumb src={src} alt={ad.headline ?? ""} className="aspect-[4/5] w-full border-0" rounded="rounded-none" />
              ) : (
                <div className="grid aspect-[4/5] place-items-center p-8 text-center text-fg-muted">{ad.headline}</div>
              )}
              <div className="absolute top-3 left-3 flex gap-1.5">
                <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", ad.is_active ? "bg-accent text-accent-fg" : "bg-black/65 text-white")}>
                  {t("ads.daysRunning", { days: ad.days })}
                </span>
                {ad.variants_count > 1 && (
                  <span className="flex items-center gap-1 rounded-md bg-black/65 px-2 py-0.5 text-xs font-semibold text-white">
                    <Layers className="size-3" /> {ad.variants_count}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{ad.headline}</p>
                <p className="truncate text-xs text-fg-muted">{ad.link_description}</p>
              </div>
              {ad.cta && <span className="shrink-0 rounded-lg bg-fg px-3 py-1.5 text-xs font-semibold text-bg">{ad.cta}</span>}
            </div>
          </Card>
          {ad.body && (
            <Card>
              <CardHeader title={t("adDetail.copy")} />
              <CardBody>
                <p className="text-sm leading-relaxed whitespace-pre-line text-fg">{ad.body}</p>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="grid content-start gap-5">
          {/* Schattingen + details */}
          <div className="grid gap-5 md:grid-cols-3">
            <Card className="p-5">
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <Users className="size-4" /> {t("ads.euReach")}
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">
                <EstimateValue estimate={ad.est_reach} t={t} />
              </p>
              <p className="mt-1 text-xs text-fg-muted">{ad.est_reach?.method}</p>
            </Card>
            <Card className="p-5">
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <Megaphone className="size-4" /> {t("ads.estSpend")}
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">
                <EstimateValue estimate={ad.est_spend} t={t} />
              </p>
              <p className="mt-1 text-xs text-fg-muted">{ad.est_spend?.method}</p>
            </Card>
            <Card className="p-5">
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <Globe className="size-4" /> {t("adDetail.countries")}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ad.countries.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 rounded-lg bg-bg-subtle px-2 py-1 text-xs font-medium">
                    <Flag country={c.trim()} className="text-[13px]" /> {countryName.of(c.trim())}
                  </span>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader icon={<CalendarDays />} title={t("adDetail.details")} />
              <CardBody>
                <dl className="space-y-2.5 text-sm">
                  {details.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4">
                      <dt className="text-fg-muted">{k}</dt>
                      <dd className="truncate text-right font-medium">{v}</dd>
                    </div>
                  ))}
                  {ad.landing_url && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-fg-muted">{t("adDetail.landing")}</dt>
                      <dd className="truncate text-right font-medium">{ad.landing_url.replace(/^https?:\/\//, "")}</dd>
                    </div>
                  )}
                </dl>
                {ad.snapshot_url && ad.platform === "google" && (
                  <a href={ad.snapshot_url} target="_blank" rel="noreferrer noopener" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent-strong hover:underline">
                    {t("adDetail.snapshot")} <ExternalLink className="size-3.5" />
                  </a>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader icon={<Megaphone />} title={t("adDetail.advertiserCard")} />
              <CardBody className="space-y-4">
                <Link href={`/explorer/advertisers/${ad.advertiser_id}`} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-hover">
                  {ad.avatar_url ? <Thumb src={ad.avatar_url} alt="" className="size-10 border-0" rounded="rounded-full" /> : <span className="grid size-10 place-items-center rounded-full bg-fg font-bold text-bg">{ad.advertiser.slice(0, 1)}</span>}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{ad.advertiser}</p>
                    <p className="text-xs text-fg-muted">
                      {formatNumber(ad.active_ads, L)} {t("advertiser.activeAds").toLowerCase()} · {formatNumber(ad.total_ads, L)} {t("advertiser.totalAds").toLowerCase()}
                    </p>
                  </div>
                </Link>
                {ad.store_id && (
                  <Link href={`/explorer/shops/${ad.store_id}`} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-hover">
                    <ShopThumb src={ad.screenshot_url} name={ad.store_name ?? ad.domain ?? ""} className="h-10 w-16" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">
                        {ad.store_name} <Flag country={ad.store_country} className="text-[13px]" />
                      </p>
                      <p className="truncate text-xs text-fg-muted">{ad.domain}</p>
                    </div>
                  </Link>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader icon={<Sparkles className="!text-accent" />} title={t("adDetail.products")} />
            {data.products.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-fg-muted">{t("adDetail.noProducts")}</p>
            ) : (
              <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2">
                {data.products.map((p) => (
                  <Link key={p.id} href={`/explorer/products/${p.id}`} className="flex items-center gap-3 bg-surface p-4 transition hover:bg-surface-hover">
                    <Thumb src={p.image_url} alt={p.canonical_title} className="size-12" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.canonical_title}</p>
                      <div className="mt-1 flex items-center gap-2">
                        {p.phase && <PhaseBadge phase={p.phase as Phase} label={t(`phases.${p.phase as Phase}`)} />}
                        <span className="flex items-center gap-1 text-xs text-fg-muted">
                          <Link2 className="size-3" /> {t(`adDetail.linkMethod.${((p.evidence as { method?: string }).method ?? "text") as "text"}`)}
                        </span>
                      </div>
                    </div>
                    {p.opportunity != null && <ScoreRing value={p.opportunity} size={40} />}
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader icon={<Layers />} title={t("adDetail.variants")} hint={t("adDetail.variantsHint")} />
              <ul className="divide-y divide-border border-t border-border text-sm">
                {data.variants.map((v) => (
                  <li key={v.id}>
                    <Link href={`/explorer/ads/${v.id}`} className={cn("flex items-center gap-3 px-5 py-2.5 hover:bg-surface-hover", v.id === ad.id && "bg-bg-subtle")}>
                      <span className={`size-2 rounded-full ${v.is_active ? "bg-accent" : "bg-fg-subtle"}`} />
                      <span className="flex-1 truncate">{v.countries.map((c) => c.trim()).join(", ")}</span>
                      <span className="text-xs text-fg-muted">{v.publisher_platforms.join(" · ")}</span>
                      <span className="text-xs text-fg-subtle">{formatDate(v.start_date, L)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader icon={<Users />} title={t("adDetail.reachHistory")} />
              <CardBody>
                {data.history.length > 1 ? (
                  <AreaChart locale={L} height={200} series={[{ name: t("ads.euReach"), points: data.history, color: "c2" }]} />
                ) : (
                  <p className="py-8 text-center text-sm text-fg-muted">—</p>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
