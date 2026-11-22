"use client";

import { useState, useTransition } from "react";
import { Copy, Loader2, Megaphone, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useT } from "@/lib/i18n/client";
import { formatDateTime } from "@/lib/utils";
import { generateProductAi } from "@/server/actions/ai";
import type { AdCopy, ProductReport } from "@/server/ai/reports";

type Stored<T> = { content: T; model: string; created_at: string | Date } | null;

function Meta({ model, at }: { model: string; at: string | Date }) {
  const t = useT();
  return <p className="text-xs text-fg-subtle">{model === "offline" ? t("assistant.offlineMade") : t("assistant.madeWith", { model, when: formatDateTime(at, t.locale) })}</p>;
}

function Section({ title, items }: { title: string; items: React.ReactNode[] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">{title}</p>
      <ul className="space-y-1.5 text-sm">{items.map((x, i) => <li key={i} className="rounded-lg bg-bg-subtle px-3 py-2">{x}</li>)}</ul>
    </div>
  );
}

function CopyLine({ text }: { text: string }) {
  return (
    <span className="flex items-start justify-between gap-2">
      <span>{text}</span>
      <button type="button" onClick={() => void navigator.clipboard?.writeText(text)} className="shrink-0 text-fg-subtle hover:text-fg" aria-label="copy"><Copy className="size-3.5" /></button>
    </span>
  );
}

export function ProductAi({ clusterId, report, copy }: { clusterId: number; report: Stored<ProductReport>; copy: Stored<AdCopy> }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (kind: "product_report" | "ad_copy", force = false) => {
    setWhich(kind);
    setError(null);
    start(async () => {
      const r = await generateProductAi(clusterId, kind, force);
      if (!r.ok) setError(r.error === "limit" ? t("assistant.limit") : t("assistant.error"));
    });
  };
  const busy = (k: string) => pending && which === k;
  const sev = { low: "neutral", medium: "warning", high: "danger" } as const;

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card data-testid="ai-report">
        <CardHeader icon={<Sparkles className="!text-accent" />} title={t("assistant.reportTitle")} hint={t("assistant.reportHint")}
          action={report ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("product_report", true)}><RefreshCw className="size-3.5" /> {t("assistant.regenerate")}</Button> : undefined} />
        <CardBody className="space-y-4">
          {report ? (
            <>
              <div className="rounded-xl bg-accent-soft/50 p-3.5">
                <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-accent-strong uppercase">{t("assistant.verdict")} <Badge tone="outline">{report.content.verdict.confidence}</Badge></p>
                <p className="mt-1 text-sm">{report.content.verdict.summary}</p>
              </div>
              <Section title={t("assistant.audience")} items={[report.content.audience.summary, ...report.content.audience.segments]} />
              <Section title={t("assistant.usps")} items={report.content.usps} />
              <Section title={t("assistant.angles")} items={report.content.ad_angles.map((a) => <><strong>{a.angle}</strong> — “{a.hook}”<br /><span className="text-xs text-fg-muted">{a.why}</span></>)} />
              <Section title={t("assistant.pricing")} items={[<><strong>€{report.content.pricing.recommended_price.toFixed(2)}</strong> — {report.content.pricing.reasoning}</>]} />
              <Section title={t("assistant.risks")} items={report.content.risks.map((r) => <span className="flex items-center gap-2"><Badge tone={sev[r.severity]}>{r.severity}</Badge>{r.risk}</span>)} />
              <Meta model={report.model} at={report.created_at} />
            </>
          ) : (
            <Button variant="accent" disabled={pending} onClick={() => run("product_report")}>{busy("product_report") ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {t("assistant.generate")}</Button>
          )}
        </CardBody>
      </Card>
      <Card data-testid="ai-copy">
        <CardHeader icon={<Megaphone />} title={t("assistant.copyTitle")} hint={t("assistant.copyHint")}
          action={copy ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("ad_copy", true)}><RefreshCw className="size-3.5" /> {t("assistant.regenerate")}</Button> : undefined} />
        <CardBody className="space-y-4">
          {copy ? (
            <>
              <Section title={t("assistant.hooks")} items={copy.content.hooks.map((h) => <CopyLine text={h} />)} />
              <Section title={t("assistant.headlines")} items={copy.content.headlines.map((h) => <CopyLine text={h} />)} />
              <Section title={t("assistant.primaryTexts")} items={copy.content.primary_texts.map((h) => <CopyLine text={h} />)} />
              <Section title={t("assistant.description")} items={[<CopyLine text={copy.content.description} />]} />
              <Section title={t("assistant.storeNames")} items={[copy.content.store_names.join(" · ")]} />
              <Meta model={copy.model} at={copy.created_at} />
            </>
          ) : (
            <Button disabled={pending} onClick={() => run("ad_copy")}>{busy("ad_copy") ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />} {t("assistant.generateCopy")}</Button>
          )}
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        </CardBody>
      </Card>
    </div>
  );
}
