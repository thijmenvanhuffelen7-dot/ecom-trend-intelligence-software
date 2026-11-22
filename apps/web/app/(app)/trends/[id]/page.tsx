import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, CalendarDays, Globe, MessageCircle, Package, Sparkles, TrendingUp } from "lucide-react";
import { keywordTrend, type Phase } from "@trendscope/core";
import { AreaChart, ForecastChart } from "@/components/charts";
import { Badge, DeltaBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Thumb } from "@/components/ui/misc";
import { PhaseBadge, ScoreRing } from "@/components/ui/score";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { NICHE_EMOJI } from "@/lib/niches";
import { formatDateTime } from "@/lib/utils";
import { getKeyword } from "@/server/queries/trends";

export const metadata = { title: "Trend" };

export default async function KeywordPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const t = await getT();
  const data = await getKeyword(Number(id));
  if (!data) notFound();
  const { keyword: k } = data;
  const L = t.locale;
  const hashtag = k.kind === "hashtag";
  const main = data.series[hashtag ? "ALL" : "NL"] ?? [];
  const trend = keywordTrend(main.map((p) => p[1]));
  const countryName = new Intl.DisplayNames([L], { type: "region" });
  const month = (m: number) => new Intl.DateTimeFormat(L, { month: "long" }).format(new Date(2026, m - 1, 15));
  // Grafiek: wekelijks gemiddelde, anders wordt 2 jaar dagdata onleesbaar
  const weekly = (s: [string, number][]) => {
    const out: [string, number][] = [];
    for (let i = 0; i < s.length; i += 7) {
      const chunk = s.slice(i, i + 7);
      out.push([chunk[0]![0], Math.round(chunk.reduce((a, p) => a + p[1], 0) / chunk.length)]);
    }
    return out;
  };

  return (
    <div className="animate-rise">
      <header className="border-b border-border bg-bg px-8 pt-6 pb-7">
        <Link href={hashtag ? "/trends?tab=hashtags" : "/trends"} className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg">
          <ArrowLeft className="size-4" /> {t("trends.back")}
        </Link>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <h1 className="text-[28px] font-semibold tracking-tight">{hashtag ? `#${k.term}` : k.term}</h1>
          <PhaseBadge phase={trend.phase as Phase} label={t(`phases.${trend.phase}`)} className="h-8 px-3 text-sm" />
          {k.niche_slug && (
            <Badge tone="outline">
              {NICHE_EMOJI[k.niche_slug]} {L === "nl" ? k.name_nl : k.name_en}
            </Badge>
          )}
          {k.peak_month ? (
            <Badge tone="warning">
              <CalendarDays /> {t("trends.seasonPeak", { month: month(k.peak_month) })}
            </Badge>
          ) : (
            <Badge>{t("trends.noSeason")}</Badge>
          )}
        </div>
        <dl className="mt-6 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-border bg-surface px-4 py-3">
            <dt className="text-xs text-fg-muted">7d</dt>
            <dd className="mt-1"><DeltaBadge value={trend.growth7d} className="text-base" /></dd>
          </div>
          <div className="rounded-2xl border border-border bg-surface px-4 py-3">
            <dt className="text-xs text-fg-muted">30d</dt>
            <dd className="mt-1"><DeltaBadge value={trend.growth30d} className="text-base" /></dd>
          </div>
          <div className="rounded-2xl border border-border bg-surface px-4 py-3">
            <dt className="text-xs text-fg-muted">{t("trends.col.interest")}</dt>
            <dd className="tabular mt-1 text-xl font-semibold">{Math.round(k.interest ?? 0)}</dd>
          </div>
          <div className="rounded-2xl border border-border bg-surface px-4 py-3">
            <dt className="text-xs text-fg-muted">{t("trends.col.forecast")}</dt>
            <dd className="mt-1">{data.forecast?.trend_30d != null ? <DeltaBadge value={data.forecast.trend_30d} className="text-base" /> : "—"}</dd>
          </div>
        </dl>
      </header>

      <div className="grid gap-5 bg-bg-subtle/60 p-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          {!hashtag && (
            <Card>
              <CardHeader icon={<Globe />} title={t("trends.interestByCountry")} hint={t("trends.estimateNote")} />
              <CardBody>
                <AreaChart locale={L} height={260} series={Object.entries(data.series).map(([c, s]) => ({ name: countryName.of(c) ?? c, points: weekly(s) }))} />
              </CardBody>
            </Card>
          )}
          <Card data-testid="keyword-forecast">
            <CardHeader
              icon={<TrendingUp />}
              title={t("trends.forecastTitle")}
              hint={t("trends.forecastHint")}
              action={data.forecast?.mape != null ? <Badge>{t("trends.mape", { pct: Math.round(data.forecast.mape) })}</Badge> : undefined}
            />
            <CardBody>
              {data.forecast ? (
                <ForecastChart
                  locale={L}
                  height={260}
                  history={main.slice(-120)}
                  forecast={data.forecast.points}
                  labels={{ actual: t("trends.actual"), expected: t("trends.expected"), band: t("trends.band") }}
                />
              ) : (
                <p className="text-sm text-fg-muted">—</p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          {!hashtag && (
            <Card>
              <CardHeader icon={<Package />} title={t("trends.relatedProducts")} />
              {data.products.length === 0 ? (
                <CardBody>
                  <p className="flex items-start gap-2 rounded-xl bg-accent-soft px-3.5 py-3 text-sm text-accent-strong">
                    <Sparkles className="mt-0.5 size-4 shrink-0" /> {t("trends.opportunityHint")}
                  </p>
                </CardBody>
              ) : (
                <ul className="divide-y divide-border border-t border-border">
                  {data.products.map((p) => (
                    <li key={p.id}>
                      <Link href={`/explorer/products/${p.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-hover">
                        <Thumb src={p.image_url} alt={p.canonical_title} className="size-11" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{p.canonical_title}</p>
                          <p className="text-xs text-fg-muted">{t("products.supplyLine", { stores: p.store_count, advertisers: "—" })}</p>
                        </div>
                        {p.phase && <PhaseBadge phase={p.phase as Phase} label={t(`phases.${p.phase as Phase}`)} />}
                        {p.opportunity !== null && <ScoreRing value={p.opportunity} size={38} />}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {!hashtag && (
            <Card>
              <CardHeader icon={<MessageCircle />} title={t("trends.redditTitle")} hint={t("trends.redditHint")} action={<Badge>{data.posts.length}</Badge>} />
              {data.reddit.length > 0 && (
                <div className="px-5 pb-2">
                  <AreaChart locale={L} height={110} series={[{ name: "Reddit", points: data.reddit, color: "c4" }]} />
                </div>
              )}
              {data.posts.length === 0 ? (
                <CardBody>
                  <p className="text-sm text-fg-muted">{t("trends.noPosts")}</p>
                </CardBody>
              ) : (
                <ul className="divide-y divide-border border-t border-border" data-testid="reddit-posts">
                  {data.posts.map((p) => (
                    <li key={p.id}>
                      <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="flex items-start gap-3 px-5 py-3 hover:bg-surface-hover">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{p.title}</p>
                          <p className="mt-0.5 text-xs text-fg-muted">
                            r/{p.subreddit} · {t("trends.upvotes", { count: p.score })} · {t("trends.comments", { count: p.comments })} · {formatDateTime(p.created_at, L)}
                          </p>
                        </div>
                        <ArrowUpRight className="size-4 shrink-0 text-fg-subtle" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
