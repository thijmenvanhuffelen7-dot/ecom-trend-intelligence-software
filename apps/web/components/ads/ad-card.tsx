import Link from "next/link";
import { ExternalLink, Layers, Play } from "lucide-react";
import type { Estimate } from "@trendscope/core";
import { Badge } from "@/components/ui/badge";
import { EstimateValue } from "@/components/ui/estimate";
import { Thumb } from "@/components/ui/misc";
import type { Translator } from "@/lib/i18n/translate";
import { flagEmoji, formatDate } from "@/lib/utils";
import { PlatformBadge } from "./platform-icon";
import { SaveToBoard } from "./save-to-board";

export interface AdCardData {
  id: string;
  platform: string;
  format: string | null;
  body: string | null;
  headline: string | null;
  cta: string | null;
  thumb: string | null;
  countries: string[];
  start_date: string | null;
  is_active: boolean;
  variants_count: number;
  days: number;
  advertiser: string;
  avatar_url?: string | null;
  store_id?: string | null;
  est_reach: Estimate | null;
  est_spend: Estimate | null;
}

export function AdCard({ ad, t }: { ad: AdCardData; t: Translator }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition hover:shadow-md">
      <div className="flex items-center gap-2.5 p-3">
        {ad.avatar_url ? (
          <Thumb src={ad.avatar_url} alt="" className="size-8 border-0" rounded="rounded-full" />
        ) : (
          <div className="grid size-8 place-items-center rounded-full bg-fg text-xs font-bold text-bg">{ad.advertiser.slice(0, 1)}</div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{ad.advertiser}</p>
          <p className="flex items-center gap-1.5 text-xs text-fg-muted">
            <PlatformBadge platform={ad.platform} /> {formatDate(ad.start_date, t.locale)}
          </p>
        </div>
        <SaveToBoard entityId={Number(ad.id)} compact />
      </div>
      {ad.body && <p className="mb-3 line-clamp-2 h-[2lh] px-3 text-sm text-fg-muted">{ad.body.replace(/\s+/g, " ")}</p>}
      <Link href={`/explorer/ads/${ad.id}`} className="relative block after:absolute after:inset-0" aria-label={ad.headline ?? "ad"}>
        {ad.thumb ? (
          <Thumb src={ad.thumb} alt={ad.headline ?? ""} className="aspect-[4/5] w-full border-x-0" rounded="rounded-none" />
        ) : (
          <div className="grid aspect-[4/5] w-full place-items-center border-y border-border bg-bg-subtle px-6 text-center text-sm text-fg-muted">
            {ad.headline ?? t(`ads.formats.${(ad.format ?? "text") as "text"}`)}
          </div>
        )}
        {ad.format === "video" && <Play className="absolute top-3 right-3 size-8 rounded-full bg-black/50 p-2 text-white" fill="currentColor" />}
        <div className="absolute top-3 left-3 flex gap-1.5">
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold backdrop-blur ${ad.is_active ? "bg-accent text-accent-fg" : "bg-black/65 text-white"}`}>
            {t("ads.daysRunning", { days: ad.days })}
          </span>
          {ad.variants_count > 1 && (
            <span className="flex items-center gap-1 rounded-md bg-black/65 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur">
              <Layers className="size-3" /> {ad.variants_count}
            </span>
          )}
        </div>
      </Link>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <p className="truncate text-sm font-semibold">{ad.headline}</p>
        {ad.cta && <span className="shrink-0 rounded-lg bg-bg-subtle px-2 py-1 text-xs font-semibold">{ad.cta}</span>}
      </div>
      <dl className="grid grid-cols-2 gap-2 p-3 text-xs">
        <div>
          <dt className="text-fg-subtle">{t("ads.euReach")}</dt>
          <dd className="relative z-10 mt-0.5 font-semibold">
            <EstimateValue estimate={ad.est_reach} t={t} />
          </dd>
        </div>
        <div>
          <dt className="text-fg-subtle">{t("ads.estSpend")}</dt>
          <dd className="relative z-10 mt-0.5 font-semibold">
            <EstimateValue estimate={ad.est_spend} t={t} />
          </dd>
        </div>
      </dl>
      <div className="mt-auto flex items-center justify-between border-t border-border px-3 py-2.5 text-xs">
        <span>{ad.countries.slice(0, 4).map((c) => flagEmoji(c.trim())).join(" ")}</span>
        {ad.store_id && (
          <Link href={`/explorer/shops/${ad.store_id}`} className="relative z-10 inline-flex items-center gap-1 font-medium text-accent-strong hover:underline">
            {t("ads.viewShop")} <ExternalLink className="size-3" />
          </Link>
        )}
        {!ad.is_active && <Badge>{t("ads.filter.inactive")}</Badge>}
      </div>
    </article>
  );
}
