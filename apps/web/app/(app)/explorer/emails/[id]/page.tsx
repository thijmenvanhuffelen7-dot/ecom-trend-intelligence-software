import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Image as ImageIcon, Package, Percent, ShieldCheck, Tag, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Thumb } from "@/components/ui/misc";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { getEmail } from "@/server/queries/emails";

export const metadata = { title: "Email" };

export default async function EmailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ images?: string }> }) {
  await requireSession();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const images = (await searchParams).images === "1";
  const t = await getT();
  const data = await getEmail(Number(id), images);
  if (!data) notFound();
  const { email: e } = data;
  const L = t.locale;
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-fg-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
  );
  return (
    <div className="animate-rise">
      <header className="border-b border-border bg-bg px-8 pt-6 pb-6">
        <Link href="/explorer/emails" className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg"><ArrowLeft className="size-4" /> {t("emails.back")}</Link>
        <h1 className="mt-3 text-[24px] font-semibold tracking-tight">{e.subject}</h1>
        <p className="mt-1 text-sm text-fg-muted">{e.preheader}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{t(`emails.types.${e.type as "promotion"}`)}</Badge>
          {e.discount_pct != null && <Badge tone="accent"><Percent /> {Math.round(e.discount_pct)}%</Badge>}
          {e.discount_code && <Badge tone="outline"><Tag /> {t("emails.code", { code: e.discount_code })}</Badge>}
          {e.free_shipping && <Badge tone="outline"><Truck /> {t("emails.freeShipping")}</Badge>}
          {e.urgency && <Badge tone="warning"><Clock /> {t("emails.urgency")}</Badge>}
        </div>
      </header>
      <div className="grid gap-5 bg-bg-subtle/60 p-6 xl:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5" /> {t("emails.sandboxNote")}</span>
            {data.hasRemoteImages && !images && (
              <span className="inline-flex items-center gap-2">
                {t("emails.imagesBlocked")}
                <Link href={`?images=1`} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 font-medium text-fg hover:bg-surface-hover"><ImageIcon className="size-3.5" /> {t("emails.loadImages")}</Link>
              </span>
            )}
          </div>
          {data.html ? (
            // sandbox zonder allow-scripts en zonder allow-same-origin: de mail kan niets uitvoeren en niets van de app lezen
            <iframe title={e.subject} srcDoc={data.html} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" className="h-[900px] w-full bg-white" data-testid="email-frame" />
          ) : (
            <pre className="p-5 text-sm whitespace-pre-wrap">{e.body_text}</pre>
          )}
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader title={t("emails.meta")} />
            <CardBody>
              <dl className="divide-y divide-border">
                {row(t("emails.from"), <>{e.sender_name}<br /><span className="text-xs text-fg-muted">{e.sender}</span></>)}
                {row(t("emails.received"), formatDateTime(e.received_at, L))}
                {e.store_id && row("Shop", <Link href={`/explorer/shops/${e.store_id}`} className="hover:underline">{e.store_name}</Link>)}
                {e.esp && row(t("emails.esp"), e.esp)}
                {e.emails_per_week != null && row(t("emails.cadence"), t("emails.perWeek", { n: e.emails_per_week.toFixed(1) }))}
              </dl>
            </CardBody>
          </Card>
          {data.products.length > 0 && (
            <Card>
              <CardHeader icon={<Package />} title={t("emails.productsInEmail")} />
              <ul className="divide-y divide-border border-t border-border">
                {data.products.map((p) => (
                  <li key={p.id}>
                    <Link href={p.cluster_id ? `/explorer/products/${p.cluster_id}` : "#"} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-hover">
                      <Thumb src={p.image} alt={p.title} className="size-10" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</span>
                      <span className="tabular text-sm">{formatMoney(p.price, p.currency ?? "EUR", L)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
