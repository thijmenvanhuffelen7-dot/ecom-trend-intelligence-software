import Link from "next/link";
import { Boxes, Flag, LayoutDashboard, Scale, Shield, Star, Users } from "lucide-react";
import type { PlanId } from "@trendscope/core";
import { ActivateVersion, AdminToggle, CurateButton, FlagEditor, PlanOverride, WeightsEditor } from "@/components/admin/admin-controls";
import { SearchBar } from "@/components/explorer/search-bar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Thumb } from "@/components/ui/misc";
import { PhaseBadge } from "@/components/ui/score";
import type { Translator } from "@/lib/i18n/translate";
import { WEIGHT_SIGNALS } from "@/lib/admin";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { ADMIN_TABS, adminCuration, adminFlags, adminWeights, adminWorkspaces, type AdminTab } from "@/server/queries/admin";

export function AdminHeader({ t, children }: { t: Translator; children: React.ReactNode }) {
  return (
    <header className="border-b border-border bg-bg px-8 pt-9 pb-0">
      <h1 className="flex items-center gap-3 text-[28px] font-semibold tracking-tight">
        <span className="grid size-10 place-items-center rounded-xl bg-bg-subtle">
          <Shield className="size-5" />
        </span>
        {t("admin.title")}
      </h1>
      {children}
    </header>
  );
}

const ICONS: Record<AdminTab, React.ReactNode> = {
  overview: <LayoutDashboard className="size-4" />,
  users: <Users className="size-4" />,
  weights: <Scale className="size-4" />,
  flags: <Flag className="size-4" />,
  curation: <Star className="size-4" />,
};

export function AdminNav({ tab, t }: { tab: AdminTab; t: Translator }) {
  return (
    <nav className="mt-6 flex gap-1 overflow-x-auto" aria-label={t("admin.title")}>
      {ADMIN_TABS.map((k) => (
        <Link
          key={k}
          href={k === "overview" ? "/admin" : `/admin?tab=${k}`}
          aria-current={tab === k ? "page" : undefined}
          className={cn(
            "flex items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-3 text-sm font-medium",
            tab === k ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
          )}
        >
          {ICONS[k]} {t(`admin.tabs.${k}`)}
        </Link>
      ))}
    </nav>
  );
}

const STATUS_TONE: Record<string, "accent" | "info" | "warning" | "danger" | "neutral"> = { active: "accent", trialing: "info", past_due: "danger", demo: "warning", canceled: "neutral", none: "neutral" };

export async function UsersTab({ t, q, selfId }: { t: Translator; q?: string; selfId: string }) {
  const { rows, totals } = await adminWorkspaces(q);
  const L = t.locale;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-md"><SearchBar placeholder={t("admin.users.search")} /></div>
        <div className="flex flex-wrap gap-2 text-sm text-fg-muted">
          <span>{t("admin.users.total")}:</span>
          {totals.map((r) => <Badge key={r.plan}>{t(`billing.plans.${r.plan}`)} · {r.n}</Badge>)}
        </div>
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm" data-testid="admin-users">
            <thead className="border-b border-border bg-bg-subtle/50 text-left text-fg-muted">
              <tr>
                <th className="px-5 py-3 font-medium">{t("admin.users.workspace")}</th>
                <th className="px-4 py-3 font-medium">{t("admin.users.members")}</th>
                <th className="px-4 py-3 font-medium">{t("admin.users.plan")}</th>
                <th className="px-4 py-3 font-medium">{t("admin.users.billing")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("admin.users.usage")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("admin.users.created")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="border-b border-border/70 align-top last:border-0">
                  <td className="px-5 py-3">
                    <p className="font-medium">{w.name}</p>
                    <p className="text-xs text-fg-muted">{w.slug}</p>
                  </td>
                  <td className="space-y-1 px-4 py-3">
                    {w.members.map((m) => (
                      <div key={m.id} className="flex flex-wrap items-center gap-2">
                        <span>{m.email}</span>
                        <Badge>{m.role}</Badge>
                        <AdminToggle userId={m.id} value={m.is_platform_admin} self={m.id === selfId} />
                      </div>
                    ))}
                  </td>
                  <td className="px-4 py-3"><PlanOverride workspaceId={w.id} plan={w.plan as PlanId} /></td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[w.billing_status] ?? "neutral"}>{t(`billing.status.${w.billing_status as "none"}`)}</Badge>
                    {w.trial_ends_at && <p className="mt-1 text-xs text-fg-muted">→ {formatDate(w.trial_ends_at, L)}</p>}
                    {w.stripe_customer_id && <p className="mt-1 font-mono text-[11px] text-fg-subtle">{w.stripe_customer_id}</p>}
                  </td>
                  <td className="tabular px-4 py-3 text-right">{formatNumber(w.usage_month, L)}</td>
                  <td className="tabular px-4 py-3 text-right text-fg-muted">{formatDate(w.created_at, L)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-fg-muted">{t("admin.users.overrideHint")}</p>
    </div>
  );
}

export async function WeightsTab({ t }: { t: Translator }) {
  const { versions, backtests } = await adminWeights();
  const active = versions.find((v) => v.is_active);
  const precision = (version: number) => {
    const b = backtests.find((x) => x.weights_version === version && x.horizon_days === 30) ?? backtests.find((x) => x.weights_version === version);
    const m = b?.metrics as { precision_at_10?: number; base_rate?: number } | undefined;
    return m?.precision_at_10 != null ? `${Math.round(m.precision_at_10 * 100)}%${m.base_rate != null ? ` (${Math.round(m.base_rate * 100)}%)` : ""}` : "—";
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1.3fr]">
      <Card>
        <CardHeader icon={<Scale />} title={t("admin.weightsEditor.title")} action={active ? <Badge tone="accent">v{active.version}</Badge> : undefined} />
        <CardBody><WeightsEditor initial={(active?.weights ?? {}) as Record<string, number>} /></CardBody>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader icon={<Boxes />} title={t("admin.weightsEditor.versions")} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="weights-versions">
            <thead className="border-y border-border bg-bg-subtle/50 text-left text-fg-muted">
              <tr>
                <th className="px-5 py-3 font-medium">v</th>
                {WEIGHT_SIGNALS.map((k) => <th key={k} className="px-2 py-3 text-right font-medium" title={t(`signals.${k}`)}>{t(`signals.${k}`).slice(0, 6)}</th>)}
                <th className="px-4 py-3 text-right font-medium">{t("admin.weightsEditor.precision")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const w = v.weights as Record<string, number>;
                return (
                  <tr key={v.version} className="border-b border-border/70 last:border-0">
                    <td className="px-5 py-3">
                      <p className="font-semibold">v{v.version}</p>
                      <p className="max-w-[220px] truncate text-xs text-fg-muted" title={v.note ?? undefined}>{v.note ?? "—"}</p>
                      <p className="text-[11px] text-fg-subtle">{formatDate(v.created_at, t.locale)}{v.created_by ? ` · ${v.created_by}` : ""}</p>
                    </td>
                    {WEIGHT_SIGNALS.map((k) => <td key={k} className="tabular px-2 py-3 text-right">{w[k] ?? "—"}</td>)}
                    <td className="tabular px-4 py-3 text-right">{precision(v.version)}</td>
                    <td className="px-4 py-3 text-right">{v.is_active ? <Badge tone="accent">{t("admin.weightsEditor.active")}</Badge> : <ActivateVersion version={v.version} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export async function FlagsTab({ t }: { t: Translator }) {
  const flags = await adminFlags();
  return (
    <Card>
      <CardHeader icon={<Flag />} title={t("admin.flags.title")} hint={t("admin.flags.hint")} />
      <CardBody className="space-y-3" data-testid="feature-flags">
        {flags.length === 0 && <p className="text-sm text-fg-muted">{t("admin.flags.none")}</p>}
        {flags.map((f) => (
          <FlagEditor key={`${f.key}-${String(f.updated_at)}`} flag={{ key: f.key, description: f.description, enabled: f.enabled, rollout: f.rollout as { percent?: number; plans?: PlanId[]; workspaces?: string[] } }} />
        ))}
        <FlagEditor />
      </CardBody>
    </Card>
  );
}

export async function CurationTab({ t, q }: { t: Translator; q?: string }) {
  const { curated, candidates } = await adminCuration(q);
  const row = (c: (typeof curated)[number]) => (
    <li key={c.id} className="flex items-center gap-3 py-2.5">
      <Thumb src={c.image_url} alt="" className="size-10" />
      <div className="min-w-0 flex-1">
        <Link href={`/explorer/products/${c.id}`} className="block truncate font-medium hover:underline">{c.canonical_title}</Link>
        <p className="text-xs text-fg-muted">
          {c.opportunity != null ? `${t("scores.opportunity")} ${Math.round(c.opportunity)} · ` : ""}
          {formatNumber(c.store_count, t.locale)} {t("explorer.shops").toLowerCase()}
        </p>
      </div>
      {c.phase && <PhaseBadge phase={c.phase} label={t(`phases.${c.phase}`)} />}
      <CurateButton clusterId={Number(c.id)} curated={c.is_curated} />
    </li>
  );
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader icon={<Star />} title={t("admin.curation.title")} hint={t("admin.curation.hint")} action={<Badge tone="accent">{curated.length}</Badge>} />
        <CardBody>
          {curated.length ? <ul className="divide-y divide-border" data-testid="curated-list">{curated.map(row)}</ul> : <EmptyState icon={<Star />} title={t("admin.curation.none")} />}
        </CardBody>
      </Card>
      <Card>
        <CardHeader icon={<Boxes />} title={t("admin.curation.candidates")} />
        <CardBody className="space-y-3">
          <SearchBar placeholder={t("admin.curation.search")} />
          <ul className="divide-y divide-border" data-testid="curation-candidates">{candidates.map(row)}</ul>
        </CardBody>
      </Card>
    </div>
  );
}
