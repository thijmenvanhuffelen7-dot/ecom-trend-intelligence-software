"use client";

import { useState, useTransition } from "react";
import { CheckCheck, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { deleteAlertRule, deleteChannel, evaluateNow, markAlertsRead, setDigest, toggleAlertRule } from "@/server/actions/alerts";

export function EvaluateButton() {
  const t = useT();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="accent" disabled={pending} onClick={() => start(async () => { const r = await evaluateNow(); if (r.ok) setMsg(t("alerts.evaluated", { count: r.events })); })} data-testid="evaluate-now">
        <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} /> {t("alerts.evaluateNow")}
      </Button>
      {msg && <span className="text-sm text-fg-muted" role="status">{msg}</span>}
    </span>
  );
}

export function MarkReadButton() {
  const t = useT();
  const [pending, start] = useTransition();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => void (await markAlertsRead()))}><CheckCheck className="size-4" /> {t("alerts.markRead")}</Button>;
}

export function RuleToggle({ id, enabled }: { id: string; enabled: boolean }) {
  const t = useT();
  const [on, setOn] = useState(enabled);
  const [, start] = useTransition();
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-fg-muted">
      <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); start(async () => void (await toggleAlertRule(id, e.target.checked))); }} />
      {t("alerts.enabled")}
    </label>
  );
}

export function DeleteButton({ id, kind }: { id: string; kind: "rule" | "channel" }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <Button size="icon" variant="ghost" aria-label={t("alerts.delete")} disabled={pending} onClick={() => start(async () => void (kind === "rule" ? await deleteAlertRule(id) : await deleteChannel(id)))}>
      <Trash2 className="size-4" />
    </Button>
  );
}

export function DigestSelect({ value }: { value: "off" | "daily" | "weekly" }) {
  const t = useT();
  const [v, setV] = useState(value);
  const [, start] = useTransition();
  return (
    <select className="h-9 rounded-xl border border-border bg-surface px-3 text-sm shadow-sm" value={v} name="digest" onChange={(e) => { const nv = e.target.value as typeof v; setV(nv); start(async () => void (await setDigest(nv))); }}>
      {(["off", "daily", "weekly"] as const).map((d) => <option key={d} value={d}>{t(`alerts.digests.${d}`)}</option>)}
    </select>
  );
}
