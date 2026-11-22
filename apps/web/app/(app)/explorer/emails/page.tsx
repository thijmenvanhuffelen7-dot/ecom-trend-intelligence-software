import Link from "next/link";
import { Clock, Mail, Percent, Tag, Truck } from "lucide-react";
import { ExplorerHeader } from "@/components/explorer/explorer-header";
import { ClearFilters, MultiFilter, Pagination, SelectFilter, SortSelect } from "@/components/explorer/filters";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ShopThumb } from "@/components/ui/misc";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/utils";
import type { SearchParams } from "@/server/queries/params";
import { EMAIL_PAGE, EMAIL_TYPES, parseEmailFilters, searchEmails } from "@/server/queries/emails";

export const metadata = { title: "Emails" };

const FILTERS = ["q", "type", "mindisc", "urgency", "store"];
const TYPE_TONE: Record<string, "accent" | "warning" | "info" | "neutral" | "outline"> = {
  promotion: "warning", welcome: "accent", product_launch: "info", newsletter: "outline", abandoned_cart: "warning",
};

export default async function EmailsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireSession();
  const sp = await searchParams;
  const t = await getT();
  const f = parseEmailFilters(sp);
  const { total, rows } = await searchEmails(f);
  const L = t.locale;
  const active = FILTERS.some((p) => sp[p]);
  return (
    <>
      <ExplorerHeader count={String(total)} countLabel={t("explorer.emails").toLowerCase()} searchPlaceholder={t("emails.title")} />
      <div className="space-y-4 bg-bg-subtle/60 px-6 pt-5 pb-6">
        <section className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <MultiFilter param="type" label={t("emails.type")} icon={<Mail />} options={EMAIL_TYPES.map((v) => ({ value: v, label: t(`emails.types.${v}`) }))} />
          <SelectFilter param="mindisc" label={t("emails.minDiscount")} icon={<Percent />} options={[10, 20, 30, 40].map((v) => ({ value: String(v), label: `≥ ${v}%` }))} />
          <SelectFilter param="urgency" label={t("emails.urgency")} icon={<Clock />} options={[{ value: "1", label: t("emails.urgencyOnly") }]} />
          {active && <ClearFilters params={FILTERS} label={t("explorer.clearFilters")} />}
          <div className="ml-auto">
            <SortSelect label={t("explorer.sortBy")} options={[{ value: "newest", label: t("emails.sortNewest") }, { value: "discount", label: t("emails.sortDiscount") }]} />
          </div>
        </section>
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface"><EmptyState icon={<Mail />} title={t("explorer.noResults")} hint={t("explorer.noResultsHint")} /></div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-sm" data-testid="email-list">
            {rows.map((e) => (
              <li key={e.id}>
                <Link href={`/explorer/emails/${e.id}`} className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-surface-hover">
                  <ShopThumb src={e.screenshot_url} name={e.store_name || e.domain} className="h-10 w-16" rounded="rounded-lg" />
                  <div className="w-44 shrink-0">
                    <p className="truncate text-sm font-semibold">{e.store_name}</p>
                    <p className="truncate text-xs text-fg-muted">{e.domain}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.subject}</p>
                    <p className="truncate text-xs text-fg-muted">{e.preheader}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge tone={TYPE_TONE[e.type] ?? "neutral"}>{t(`emails.types.${e.type as "promotion"}`)}</Badge>
                    {e.discount_pct != null && <Badge tone="accent"><Percent /> {Math.round(e.discount_pct)}%</Badge>}
                    {e.discount_code && <Badge tone="outline"><Tag /> {e.discount_code}</Badge>}
                    {e.free_shipping && <Truck className="size-4 text-fg-subtle" aria-label={t("emails.freeShipping")} />}
                    {e.urgency && <Clock className="size-4 text-warning" aria-label={t("emails.urgency")} />}
                  </div>
                  <span className="w-32 shrink-0 text-right text-xs text-fg-subtle">{formatDateTime(e.received_at, L)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={f.page} total={total} pageSize={EMAIL_PAGE} labels={{ prev: t("explorer.prev"), next: t("explorer.next"), page: t("explorer.page", { page: f.page, total: Math.max(1, Math.ceil(total / EMAIL_PAGE)) }) }} />
      </div>
    </>
  );
}
