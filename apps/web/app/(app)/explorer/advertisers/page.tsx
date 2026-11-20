import Link from "next/link";
import { Layers } from "lucide-react";
import { PlatformBadge } from "@/components/ads/platform-icon";
import { ExplorerHeader } from "@/components/explorer/explorer-header";
import { MultiFilter, Pagination } from "@/components/explorer/filters";
import { DeltaBadge } from "@/components/ui/badge";
import { Flag, ShopThumb, Thumb } from "@/components/ui/misc";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { formatCompact, formatDate, formatNumber } from "@/lib/utils";
import { AD_PAGE_SIZE, AD_PLATFORMS, searchAdvertisers } from "@/server/queries/ads";
import type { SearchParams } from "@/server/queries/params";

export const metadata = { title: "Advertisers" };

export default async function AdvertisersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireSession();
  const sp = await searchParams;
  const t = await getT();
  const L = t.locale;
  const { total, rows, page } = await searchAdvertisers(sp);
  const head = "px-5 py-3.5 text-left text-sm font-medium text-fg-muted whitespace-nowrap";
  return (
    <>
      <ExplorerHeader count={formatCompact(total, L)} countLabel={t("explorer.advertisers").toLowerCase()} searchPlaceholder={t("explorer.searchAdvertisers")} demo={{ label: t("explorer.demoData"), hint: t("explorer.demoDataHint") }} />
      <div className="space-y-4 bg-bg-subtle/60 px-6 pt-5 pb-6">
        <MultiFilter param="platform" label={t("advertiser.platform")} icon={<Layers />} options={AD_PLATFORMS.map((p) => ({ value: p, label: t(`adDetail.source.${p}`) }))} />
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <table className="w-full border-collapse">
            <thead className="border-b border-border bg-bg-subtle/50">
              <tr>
                <th className={head}>{t("advertisers.col.advertiser")}</th>
                <th className={head}>{t("advertisers.col.shop")}</th>
                <th className={`${head} text-right`}>{t("advertisers.col.active")}</th>
                <th className={`${head} text-right`}>{t("advertiser.newAds7d")}</th>
                <th className={`${head} text-right`}>{t("advertisers.col.total")}</th>
                <th className={`${head} text-right`}>{t("advertisers.col.reach")}</th>
                <th className={`${head} text-right`}>{t("advertiser.firstAd")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="group relative border-b border-border last:border-0 hover:bg-bg-subtle/60">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      {r.avatar_url ? <Thumb src={r.avatar_url} alt="" className="size-9 border-0" rounded="rounded-full" /> : <div className="grid size-9 place-items-center rounded-full bg-info-soft text-sm font-bold text-info">{r.name.slice(0, 1)}</div>}
                      <div>
                        <Link href={`/explorer/advertisers/${r.id}`} className="font-semibold after:absolute after:inset-0 hover:underline">
                          {r.name}
                        </Link>
                        <p className="mt-0.5">
                          <PlatformBadge platform={r.platform} />
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {r.store_id && (
                      <Link href={`/explorer/shops/${r.store_id}`} className="relative z-10 flex items-center gap-2.5 hover:underline">
                        <ShopThumb src={r.screenshot_url} name={r.domain ?? ""} className="h-8 w-12" rounded="rounded-md" />
                        <span className="text-sm">{r.domain}</span>
                        <Flag country={r.country} className="text-[13px]" />
                      </Link>
                    )}
                  </td>
                  <td className="tabular px-5 py-3 text-right font-semibold">
                    <span className="mr-1.5 inline-block size-2 rounded-full bg-accent" />
                    {formatNumber(r.active_ads, L)}
                  </td>
                  <td className="px-5 py-3 text-right">{r.new_ads_7d > 0 ? <DeltaBadge value={r.new_ads_7d} suffix="" /> : <span className="text-fg-subtle">0</span>}</td>
                  <td className="tabular px-5 py-3 text-right">{formatNumber(r.total_ads, L)}</td>
                  <td className="tabular px-5 py-3 text-right">{Number(r.eu_reach_total) ? formatCompact(Number(r.eu_reach_total), L) : "—"}</td>
                  <td className="px-5 py-3 text-right text-sm text-fg-muted">{formatDate(r.first_ad_at, L)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={total} pageSize={AD_PAGE_SIZE} labels={{ prev: t("explorer.prev"), next: t("explorer.next"), page: t("explorer.page", { page, total: Math.max(1, Math.ceil(total / AD_PAGE_SIZE)) }) }} />
      </div>
    </>
  );
}
