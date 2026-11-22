"use client";

import { useState, useTransition } from "react";
import { Check, Plus, Save, Star, StarOff, Trash2 } from "lucide-react";
import { PLAN_IDS, type PlanId } from "@trendscope/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { WEIGHT_SIGNALS } from "@/lib/admin";
import { activateWeightsVersion, createWeightsVersion, deleteFeatureFlag, overrideWorkspacePlan, saveFeatureFlag, setCurated, setPlatformAdmin } from "@/server/actions/admin";

const selectCls = "h-8 rounded-lg border border-border bg-surface px-2 text-sm";

export function PlanOverride({ workspaceId, plan }: { workspaceId: string; plan: PlanId }) {
  const t = useT();
  const [value, setValue] = useState(plan);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        aria-label={t("admin.users.plan")}
        className={selectCls}
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as PlanId;
          setValue(next);
          setSaved(false);
          start(async () => setSaved((await overrideWorkspacePlan({ workspaceId, plan: next })).ok));
        }}
      >
        {PLAN_IDS.map((p) => <option key={p} value={p}>{t(`billing.plans.${p}`)}</option>)}
      </select>
      {saved && <Check className="size-4 text-success" aria-label={t("admin.saved")} />}
    </span>
  );
}

export function AdminToggle({ userId, value, self }: { userId: string; value: boolean; self: boolean }) {
  const t = useT();
  const [on, setOn] = useState(value);
  const [pending, start] = useTransition();
  return (
    <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-fg-muted" title={self ? t("admin.users.selfHint") : undefined}>
      <input
        type="checkbox"
        checked={on}
        disabled={pending || (self && on)}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          start(async () => { if (!(await setPlatformAdmin({ userId, value: next })).ok) setOn(!next); });
        }}
      />
      {t("admin.users.platformAdmin")}
    </label>
  );
}

export function WeightsEditor({ initial }: { initial: Record<string, number> }) {
  const t = useT();
  const [w, setW] = useState<Record<string, number>>(() => Object.fromEntries(WEIGHT_SIGNALS.map((k) => [k, initial[k] ?? 1])));
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const changed = WEIGHT_SIGNALS.some((k) => w[k] !== (initial[k] ?? 1));
  const save = (activate: boolean) =>
    start(async () => {
      const r = await createWeightsVersion({ weights: w, note: note || undefined, activate });
      setMsg(r.ok ? t("admin.weightsEditor.saved", { version: r.version }) : r.error === "all_zero" ? t("admin.weightsEditor.allZero") : r.error);
      if (r.ok) setNote("");
    });
  return (
    <div className="space-y-3" data-testid="weights-editor">
      {WEIGHT_SIGNALS.map((k) => (
        <label key={k} className="grid grid-cols-[130px_1fr_56px] items-center gap-3 text-sm">
          <span>{t(`signals.${k}`)}</span>
          <input type="range" min={0} max={3} step={0.1} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="accent-[var(--color-accent)]" aria-label={t(`signals.${k}`)} />
          <span className="tabular text-right font-semibold">{w[k]!.toFixed(1)}</span>
        </label>
      ))}
      <Input placeholder={t("admin.weightsEditor.note")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || !changed} onClick={() => save(false)}><Save className="size-4" /> {t("admin.weightsEditor.saveDraft")}</Button>
        <Button size="sm" variant="accent" disabled={pending || !changed} onClick={() => save(true)}><Check className="size-4" /> {t("admin.weightsEditor.saveActivate")}</Button>
        {msg && <span className="text-sm text-fg-muted" role="status">{msg}</span>}
      </div>
      <p className="text-xs text-fg-muted">{t("admin.weightsEditor.hint")}</p>
    </div>
  );
}

export function ActivateVersion({ version }: { version: number }) {
  const t = useT();
  const [pending, start] = useTransition();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => void (await activateWeightsVersion(version)))}>{t("admin.weightsEditor.activate")}</Button>;
}

type FlagRow = { key: string; description: string | null; enabled: boolean; rollout: { percent?: number; plans?: PlanId[]; workspaces?: string[] } };

export function FlagEditor({ flag }: { flag?: FlagRow }) {
  const t = useT();
  const [key, setKey] = useState(flag?.key ?? "");
  const [description, setDescription] = useState(flag?.description ?? "");
  const [enabled, setEnabled] = useState(flag?.enabled ?? false);
  const [percent, setPercent] = useState(flag?.rollout.percent ?? 100);
  const [plans, setPlans] = useState<PlanId[]>(flag?.rollout.plans ?? []);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const isNew = !flag;
  return (
    <div className="grid gap-3 rounded-xl border border-border p-4 lg:grid-cols-[1.1fr_1.4fr_auto]" data-testid={isNew ? "flag-new" : `flag-${flag.key}`}>
      <div className="space-y-2">
        {isNew ? (
          <Input placeholder="public_api" value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} aria-label={t("admin.flags.key")} />
        ) : (
          <p className="font-mono text-sm font-semibold">{flag.key}</p>
        )}
        <Input placeholder={t("admin.flags.description")} value={description} onChange={(e) => setDescription(e.target.value)} aria-label={t("admin.flags.description")} />
      </div>
      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-3">
          <span className="w-24 text-fg-muted">{t("admin.flags.percent")}</span>
          <input type="range" min={0} max={100} step={5} value={percent} onChange={(e) => setPercent(Number(e.target.value))} className="flex-1" aria-label={t("admin.flags.percent")} />
          <span className="tabular w-10 text-right font-semibold">{percent}%</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-24 text-fg-muted">{t("admin.flags.plans")}</span>
          {PLAN_IDS.map((p) => (
            <label key={p} className="inline-flex items-center gap-1">
              <input type="checkbox" checked={plans.includes(p)} onChange={(e) => setPlans(e.target.checked ? [...plans, p] : plans.filter((x) => x !== p))} />
              {t(`billing.plans.${p}`)}
            </label>
          ))}
        </div>
        <p className="text-xs text-fg-muted">{plans.length ? "" : t("admin.flags.allPlans")}</p>
      </div>
      <div className="flex items-start gap-2">
        <label className="inline-flex h-8 items-center gap-1.5 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t("admin.flags.enabled")}
        </label>
        <Button
          size="sm"
          variant={isNew ? "accent" : "outline"}
          disabled={pending || !key}
          onClick={() =>
            start(async () => {
              const r = await saveFeatureFlag({ key, description: description || undefined, enabled, rollout: { percent, plans, workspaces: flag?.rollout.workspaces ?? [] } });
              setMsg(r.ok ? t("admin.saved") : t("admin.flags.invalid"));
              if (r.ok && isNew) { setKey(""); setDescription(""); }
            })
          }
        >
          {isNew ? <Plus className="size-4" /> : <Save className="size-4" />} {isNew ? t("admin.flags.add") : t("admin.flags.save")}
        </Button>
        {!isNew && (
          <Button size="icon" variant="ghost" aria-label={t("admin.flags.delete")} disabled={pending} onClick={() => start(async () => void (await deleteFeatureFlag(flag.key)))}>
            <Trash2 className="size-4" />
          </Button>
        )}
        {msg && <span className="self-center text-xs text-fg-muted" role="status">{msg}</span>}
      </div>
    </div>
  );
}

export function CurateButton({ clusterId, curated }: { clusterId: number; curated: boolean }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant={curated ? "ghost" : "outline"} disabled={pending} onClick={() => start(async () => void (await setCurated({ clusterId, value: !curated })))}>
      {curated ? <StarOff className="size-4" /> : <Star className="size-4" />} {curated ? t("admin.curation.remove") : t("admin.curation.add")}
    </Button>
  );
}
