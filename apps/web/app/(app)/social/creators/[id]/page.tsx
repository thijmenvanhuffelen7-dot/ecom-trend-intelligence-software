import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye, Heart, Mail, Package, Radio, ShieldCheck, TrendingUp, Users, Video } from "lucide-react";
import type { Phase } from "@trendscope/core";
import { getDb } from "@trendscope/db";
import { AreaChart } from "@/components/charts";
import { Badge, DeltaBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EstimateValue } from "@/components/ui/estimate";
import { Flag, Thumb } from "@/components/ui/misc";
import { PhaseBadge, ScoreRing } from "@/components/ui/score";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { NICHE_EMOJI } from "@/lib/niches";
import { formatCompact, formatDateTime } from "@/lib/utils";
import { getCreator } from "@/server/queries/social";

export const metadata = { title: "Creator" };

const PLATFORM_NAME: Record<string, string> = { tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram" };

export default async function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const t = await getT();
  const data = await getCreator(Number(id));
  if (!data) notFound();
  const { creator: c } = data;
  const nicheName = Object.fromEntries(
    (await getDb().selectFrom("niches").select(["slug", "name_nl", "name_en"]).execute()).map((n) => [n.slug, t.locale === "nl" ? n.name_nl : n.name_en]),
  );
  const L = t.locale;
  const stat = (label: string, value: React.ReactNode, hint?: string) => (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3" title={hint}>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="tabular mt-1 text-xl font-semibold">{value}</dd>
    </div>
  );

  return (
    <div className="animate-rise">
      <header className="border-b border-border bg-bg px-8 pt-6 pb-7">
        <Link href="/social?tab=creators" className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg">
          <ArrowLeft className="size-4" /> {t("social.back")}
        </Link>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Thumb src={c.avatar_url} alt={c.handle} className="size-16" rounded="rounded-full" />
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">
              @{c.handle} {c.country && <Flag country={c.country} className="ml-1 text-xl" />}
            </h1>
            <p className="text-sm text-fg-muted">
              <span>{PLATFORM_NAME[c.platform] ?? c.platform}</span>
              {c.display_name && ` · ${c.display_name}`}
              {c.niches.length > 0 && ` · ${c.niches.map((n) => `${NICHE_EMOJI[n] ?? ""} ${nicheName[n] ?? n}`).join(", ")}`}
            </p>
            {c.bio && <p className="mt-1 text-sm">{c.bio}</p>}
          </div>
          <div className="ml-auto">
            {c.contact?.business_email ? (
              <a href={`mailto:${c.contact.business_email}`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg">
                <Mail className="size-4" /> {c.contact.business_email}
              </a>
            ) : (
              <Badge>{t("social.noContact")}</Badge>
            )}
          </div>
        </div>
        <dl className="mt-6 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-5">
          {stat(t("social.col.followers"), c.followers != null ? formatCompact(c.followers, L) : "—")}
          {stat(t("social.col.growth7"), c.followers_growth_7d != null ? <DeltaBadge value={c.followers_growth_7d} className="text-base" /> : "—")}
          {stat(t("social.col.engagement"), c.engagement_rate != null ? `${(c.engagement_rate * 100).toFixed(1)}%` : "—")}
          {stat(t("social.col.avgViews"), c.avg_views != null ? formatCompact(c.avg_views, L) : "—")}
          {stat(t("social.col.gmv30"), <span className="text-base"><EstimateValue estimate={c.gmv} t={t} /></span>, t("social.creatorGmvHint"))}
        </dl>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-subtle"><ShieldCheck className="size-3.5" /> {t("social.privacy")}</p>
      </header>

      <div className="grid gap-5 bg-bg-subtle/60 p-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader icon={<Users />} title={t("social.followersChart")} />
            <CardBody>
              <AreaChart locale={L} height={200} series={[{ name: t("social.col.followers"), points: data.followers }]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<Video />} title={t("social.recentVideos")} action={<Badge>{c.videos_count ?? data.videos.length}</Badge>} />
            <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="creator-videos">
              {data.videos.map((v) => (
                <a key={v.id} href={v.url ?? "#"} target="_blank" rel="noopener noreferrer nofollow" className="overflow-hidden rounded-xl border border-border">
                  <div className="relative">
                    <Thumb src={v.thumbnail_url} alt="" className="aspect-[9/12] w-full border-0" rounded="rounded-none" />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 pt-6 pb-1.5 text-[11px] font-semibold text-white">
                      <span className="flex items-center gap-1"><Eye className="size-3" /> {formatCompact(Number(v.views ?? 0), L)}</span>
                      <span className="flex items-center gap-1"><Heart className="size-3" /> {formatCompact(Number(v.likes ?? 0), L)}</span>
                    </div>
                  </div>
                  <p className="truncate px-2 py-1.5 text-[11px] text-fg-muted">{v.product_title ?? t("social.noProduct")}</p>
                </a>
              ))}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader icon={<Package />} title={t("social.promotedProducts")} />
            <ul className="divide-y divide-border border-t border-border">
              {data.products.map((p) => (
                <li key={p.id}>
                  <Link href={`/explorer/products/${p.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-hover">
                    <Thumb src={p.image_url} alt={p.canonical_title} className="size-10" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.canonical_title}</span>
                    {p.phase && <PhaseBadge phase={p.phase as Phase} label={t(`phases.${p.phase as Phase}`)} />}
                    {p.opportunity !== null && <ScoreRing value={p.opportunity} size={34} />}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader icon={<Radio />} title={t("social.recentLives")} />
            {data.lives.length === 0 ? (
              <CardBody><p className="text-sm text-fg-muted">—</p></CardBody>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {data.lives.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <TrendingUp className="size-4 text-fg-subtle" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{l.title}</p>
                      <p className="text-xs text-fg-muted">{formatDateTime(l.started_at, L)} · {t("social.minutes", { n: l.duration_min ?? 0 })} · {formatCompact(l.peak_viewers ?? 0, L)} {t("social.col.viewers").toLowerCase()}</p>
                    </div>
                    <EstimateValue estimate={l.gmvEst} t={t} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
