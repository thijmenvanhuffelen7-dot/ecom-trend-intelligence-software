"use client";

import { useState, useTransition } from "react";
import { BellPlus } from "lucide-react";
import { PHASES, RULE_KINDS, type AlertRule, type RuleKind } from "@trendscope/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { createAlertRule } from "@/server/actions/alerts";

const Label = ({ children }: { children: React.ReactNode }) => <span className="mb-1 block text-xs font-medium text-fg-muted">{children}</span>;
const selectCls = "h-9 w-full rounded-xl border border-border bg-surface px-3 text-sm shadow-sm focus:ring-2 focus:ring-accent/25 focus:outline-none";

/** No-code regelbouwer: kies een soort, vul de begrensde parameters in, kies kanalen. Validatie gebeurt (ook) op de server. */
export function RuleBuilder({ channels, niches }: { channels: { id: string; name: string; type: string }[]; niches: { slug: string; label: string }[] }) {
  const t = useT();
  const [kind, setKind] = useState<RuleKind>("score_threshold");
  const [name, setName] = useState("");
  const [p, setP] = useState<Record<string, string>>({ metric: "validation", op: "gt", value: "70", scope: "all", to: "emerging", min: "10", days: "7", pct: "50", window: "7d", keywordKind: "keyword", niche: "" });
  const [selected, setSelected] = useState<string[]>([]);
  const [cooldown, setCooldown] = useState("24");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setP((x) => ({ ...x, [k]: e.target.value }));
  const nichesArr = p.niche ? [p.niche] : [];

  function rule(): AlertRule {
    switch (kind) {
      case "score_threshold":
        return { kind, metric: p.metric as "validation", op: p.op as "gt", value: Number(p.value), scope: p.scope as "all", niches: nichesArr };
      case "phase_change":
        return { kind, to: [p.to as "emerging"], scope: p.scope as "all" };
      case "store_new_products":
      case "advertiser_new_ads":
        return { kind, min: Number(p.min), days: Number(p.days), scope: p.scope as "all" };
      case "keyword_growth":
        return { kind, pct: Number(p.pct), window: p.window as "7d", keywordKind: p.keywordKind as "keyword" };
      case "competitor_price_drop":
        return { kind, pct: Number(p.pct), scope: "watchlist" };
      case "new_store_launch":
        return { kind, niches: nichesArr };
    }
  }

  const scopeField = (
    <label className="block">
      <Label>{t("alerts.scope")}</Label>
      <select className={selectCls} value={p.scope} onChange={set("scope")} name="scope">
        <option value="watchlist">{t("alerts.scopes.watchlist")}</option>
        <option value="all">{t("alerts.scopes.all")}</option>
      </select>
    </label>
  );
  const nicheField = (
    <label className="block">
      <Label>{t("alerts.niches")}</Label>
      <select className={selectCls} value={p.niche} onChange={set("niche")} name="niche">
        <option value="">—</option>
        {niches.map((n) => <option key={n.slug} value={n.slug}>{n.label}</option>)}
      </select>
    </label>
  );

  return (
    <form
      className="space-y-4"
      data-testid="rule-builder"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        start(async () => {
          const res = await createAlertRule({ name: name || t(`alerts.kinds.${kind}`), rule: rule(), channels: selected, cooldownHours: Number(cooldown) });
          if (res.ok) {
            setMessage(t("alerts.created"));
            setName("");
          } else setMessage(res.error === "limit" ? t("alerts.limit") : t("alerts.invalid", { error: res.error }));
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <Label>{t("alerts.kind")}</Label>
          <select className={selectCls} value={kind} onChange={(e) => setKind(e.target.value as RuleKind)} name="kind">
            {RULE_KINDS.map((k) => <option key={k} value={k}>{t(`alerts.kinds.${k}`)}</option>)}
          </select>
        </label>
        <label className="block">
          <Label>{t("alerts.name")}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t(`alerts.kinds.${kind}`)} maxLength={80} name="name" />
        </label>
      </div>
      <div className="grid gap-3 rounded-2xl bg-bg-subtle p-3 sm:grid-cols-3">
        {kind === "score_threshold" && (
          <>
            <label className="block">
              <Label>{t("alerts.metric")}</Label>
              <select className={selectCls} value={p.metric} onChange={set("metric")} name="metric">
                {(["validation", "opportunity", "growth_velocity"] as const).map((m) => <option key={m} value={m}>{t(`alerts.metrics.${m}`)}</option>)}
              </select>
            </label>
            <label className="block">
              <Label>{t("alerts.op.gt")} / {t("alerts.op.lt")}</Label>
              <div className="flex gap-2">
                <select className={selectCls} value={p.op} onChange={set("op")} name="op">
                  <option value="gt">&gt;</option>
                  <option value="lt">&lt;</option>
                </select>
                <Input type="number" value={p.value} onChange={set("value")} min={-100} max={1000} name="value" />
              </div>
            </label>
            {scopeField}
            {nicheField}
          </>
        )}
        {kind === "phase_change" && (
          <>
            <label className="block">
              <Label>{t("alerts.toPhase")}</Label>
              <select className={selectCls} value={p.to} onChange={set("to")} name="to">
                {PHASES.map((ph) => <option key={ph} value={ph}>{t(`phases.${ph}`)}</option>)}
              </select>
            </label>
            {scopeField}
          </>
        )}
        {(kind === "store_new_products" || kind === "advertiser_new_ads") && (
          <>
            <label className="block"><Label>{t("alerts.min")}</Label><Input type="number" min={1} max={500} value={p.min} onChange={set("min")} name="min" /></label>
            <label className="block"><Label>{t("alerts.days")}</Label><Input type="number" min={1} max={30} value={p.days} onChange={set("days")} name="days" /></label>
            {scopeField}
          </>
        )}
        {(kind === "keyword_growth" || kind === "competitor_price_drop") && (
          <label className="block"><Label>{t("alerts.pct")}</Label><Input type="number" min={1} max={kind === "keyword_growth" ? 10_000 : 90} value={p.pct} onChange={set("pct")} name="pct" /></label>
        )}
        {kind === "keyword_growth" && (
          <>
            <label className="block">
              <Label>{t("alerts.window")}</Label>
              <select className={selectCls} value={p.window} onChange={set("window")} name="window"><option value="7d">7d</option><option value="30d">30d</option></select>
            </label>
            <label className="block">
              <Label>{t("alerts.keywordKind")}</Label>
              <select className={selectCls} value={p.keywordKind} onChange={set("keywordKind")} name="keywordKind">
                <option value="keyword">{t("trends.tabs.keywords")}</option>
                <option value="hashtag">{t("trends.tabs.hashtags")}</option>
              </select>
            </label>
          </>
        )}
        {kind === "new_store_launch" && nicheField}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <div>
          <Label>{t("alerts.channels")}</Label>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-lg border border-border bg-bg-subtle px-2.5 py-1 text-fg-muted">{t("alerts.inAppAlways")}</span>
            {channels.map((c) => (
              <label key={c.id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1">
                <input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} />
                {c.name} <span className="text-xs text-fg-subtle">{t(`alerts.channelTypes.${c.type as "slack"}`)}</span>
              </label>
            ))}
          </div>
        </div>
        <label className="block">
          <Label>{t("alerts.cooldown")}</Label>
          <select className={selectCls} value={cooldown} onChange={(e) => setCooldown(e.target.value)} name="cooldown">
            {[6, 24, 72, 168].map((h) => <option key={h} value={h}>{t("alerts.hours", { n: h })}</option>)}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="accent" disabled={pending}><BellPlus className="size-4" /> {t("alerts.create")}</Button>
        {message && <span className="text-sm text-fg-muted" role="status">{message}</span>}
      </div>
    </form>
  );
}
