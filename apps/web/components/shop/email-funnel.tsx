import Link from "next/link";
import { Clock, Filter, Mail, Percent } from "lucide-react";
import { BarChart } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { Translator } from "@/lib/i18n/translate";
import { FUNNEL_STEPS, funnelFor } from "@/lib/funnel";
import { cn, formatDateTime } from "@/lib/utils";
import { storeEmailSummary } from "@/server/queries/emails";

const SUB_TONE: Record<string, "accent" | "warning" | "danger" | "neutral"> = { confirmed: "accent", subscribed: "accent", manual: "warning", failed: "danger" };

/** Winkeldetail: e-mailmarketing (cadans, mix, laatste mails) en de funnel per stap. */
export async function ShopEmailFunnel({ storeId, techs, emailsPerWeek, avgDiscount, esp, t }: {
  storeId: string; techs: string[]; emailsPerWeek: number | null; avgDiscount: number | null; esp: string | null; t: Translator;
}) {
  const data = await storeEmailSummary(storeId);
  const L = t.locale;
  const funnel = funnelFor(techs);
  return (
    <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
      <Card data-testid="shop-emails">
        <CardHeader
          icon={<Mail />}
          title={t("emails.storeTitle")}
          action={data.subscription ? (
            <Badge tone={SUB_TONE[data.subscription.status] ?? "neutral"}>{t(`emails.subscription.${data.subscription.status as "confirmed"}`)}</Badge>
          ) : undefined}
        />
        <CardBody className="space-y-4">
          {!data.subscription && <p className="text-sm text-fg-muted">{t("emails.notSubscribed")}</p>}
          {data.recent.length > 0 ? (
            <>
              <dl className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-bg-subtle px-3 py-2"><dt className="text-xs text-fg-muted">{t("emails.cadence")}</dt><dd className="tabular text-lg font-semibold">{emailsPerWeek?.toFixed(1) ?? "—"}</dd></div>
                <div className="rounded-xl bg-bg-subtle px-3 py-2"><dt className="text-xs text-fg-muted">{t("emails.avgDiscount")}</dt><dd className="tabular text-lg font-semibold">{avgDiscount != null ? `${Math.round(avgDiscount)}%` : "—"}</dd></div>
                <div className="rounded-xl bg-bg-subtle px-3 py-2"><dt className="text-xs text-fg-muted">{t("emails.esp")}</dt><dd className="truncate text-lg font-semibold">{esp ?? "—"}</dd></div>
              </dl>
              {data.weekly.length > 1 && <BarChart data={data.weekly.map(([w, n]) => ({ name: w, value: n }))} height={120} locale={L} />}
              <p className="flex flex-wrap gap-1.5 text-xs">
                {data.mix.map((m) => <Badge key={m.type}>{t(`emails.types.${m.type as "promotion"}`)} · {m.n}</Badge>)}
              </p>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {data.recent.map((e) => (
                  <li key={e.id}>
                    <Link href={`/explorer/emails/${e.id}`} className="flex items-center gap-3 px-3.5 py-2.5 text-sm hover:bg-surface-hover">
                      <span className="min-w-0 flex-1 truncate font-medium">{e.subject}</span>
                      {e.discount_pct != null && <Badge tone="accent"><Percent /> {Math.round(e.discount_pct)}</Badge>}
                      {e.urgency && <Clock className="size-3.5 text-warning" />}
                      <span className="w-28 shrink-0 text-right text-xs text-fg-subtle">{formatDateTime(e.received_at, L)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href={`/explorer/emails?store=${storeId}`} className="text-sm font-medium text-accent-strong hover:underline">{t("emails.all")}</Link>
            </>
          ) : (
            data.subscription && <p className="text-sm text-fg-muted">{t("emails.noEmails")}</p>
          )}
        </CardBody>
      </Card>
      <Card data-testid="shop-funnel">
        <CardHeader icon={<Filter />} title={t("funnel.title")} hint={t("funnel.hint")} />
        <CardBody>
          <ol className="relative space-y-3 border-l border-border pl-5">
            {FUNNEL_STEPS.map((step) => {
              const tools = funnel.find((f) => f.step === step)?.tools ?? [];
              return (
                <li key={step} className="relative">
                  <span className={cn("absolute top-1.5 -left-[26px] size-3 rounded-full border-2 border-surface", tools.length ? "bg-accent" : "bg-border-strong")} />
                  <p className="text-sm font-semibold">{t(`funnel.steps.${step}`)}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {tools.length ? tools.map((x) => (
                      <Badge key={x.name} tone="outline">{x.name} <span className="text-fg-subtle">· {t(`funnel.roles.${x.role as "popup"}`)}</span></Badge>
                    )) : <span className="text-xs text-fg-subtle">{t("funnel.none")}</span>}
                  </p>
                </li>
              );
            })}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
