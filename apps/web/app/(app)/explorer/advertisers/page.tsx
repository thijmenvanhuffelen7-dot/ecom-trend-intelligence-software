import Link from "next/link";
import { ExplorerHeader } from "@/components/explorer/explorer-header";
import { Pagination } from "@/components/explorer/filters";
import { Flag, Thumb } from "@/components/ui/misc";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { formatCompact, formatDate } from "@/lib/utils";
import { AD_PAGE_SIZE, searchAdvertisers } from "@/server/queries/ads";
import type { SearchParams } from "@/server/queries/params";

export const metadata = { title: "Advertisers" };

export default async function AdvertisersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireSession();
  const sp = await searchParams;
  const t = await getT();
  const { total, rows, page } = await searchAdvertisers(sp);
  const head = "px-5 py-3.5 text-left text-sm font-medium text-fg-muted whitespace-nowrap";
  return (
    <>
      <ExplorerHeader count={String(total)} countLabel={t("explorer.advertisers").toLowerCase()} searchPlaceholder={t("explorer.searchAdvertisers")} demo={{ label: t("explorer.demoData"), hint: t("explorer.demoDataHint") }} />
      <div className="bg-bg-subtle/60 px-6 pt-5 pb-6">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <table className="w-full border-collapse">
            <thead className="border-b border-border bg-bg-subtle/50">
              <tr>
                <th className={head}>{t("advertisers.col.advertiser")}</th>
                <th className={head}>{t("advertisers.col.shop")}</th>
                <th className={`${head} text-right`}>{t("advertisers.col.active")}</th>
                <th className={`${head} text-right`}>{t("advertisers.col.total")}</th>
                <th className={`${head} text-right`}>{t("advertisers.col.reach")}</th>
                <th className={`${head} text-right`}>{t("advertisers.col.firstSeen")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-bg-subtle/60">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="grid size-9 place-items-center rounded-full bg-info-soft text-sm font-bold text-info">{r.name.slice(0, 1)}</div>
                      <div>
                        <p className="font-semibold">{r.name}</p>
                        <p className="text-xs text-fg-muted capitalize">{r.platform}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {r.store_id && (
                      <Link href={`/explorer/shops/${r.store_id}`} className="flex items-center gap-2.5 hover:underline">
                        <Thumb src={r.screenshot_url} alt="" className="h-8 w-12" rounded="rounded-md" />
                        <span className="text-sm">{r.domain}</span>
                        <Flag country={r.country} className="text-[13px]" />
                      </Link>
                    )}
                  </td>
                  <td className="tabular px-5 py-3 text-right font-semibold">
                    <span className="mr-1.5 inline-block size-2 rounded-full bg-accent" />
                    {r.active}
                  </td>
                  <td className="tabular px-5 py-3 text-right">{r.total_ads}</td>
                  <td className="tabular px-5 py-3 text-right">{formatCompact(r.reach, t.locale)}</td>
                  <td className="px-5 py-3 text-right text-sm text-fg-muted">{formatDate(r.first_seen, t.locale)}</td>
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
