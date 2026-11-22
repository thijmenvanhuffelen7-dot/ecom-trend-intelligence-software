import Link from "next/link";
import { BookOpen, KeyRound, Lock } from "lucide-react";
import { getDb } from "@trendscope/db";
import { can, PLANS } from "@trendscope/core";
import { CreateKeyForm, RevokeKey } from "@/components/api/api-key-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { API_RATE_PER_MINUTE } from "@/server/api/auth";
import { usageOverview } from "@/server/billing/usage";
import { featureEnabled } from "@/server/flags";

export const metadata = { title: "API" };
export const dynamic = "force-dynamic";

export default async function ApiSettingsPage() {
  const session = await requireSession();
  const t = await getT();
  const L = t.locale;
  const quota = PLANS[session.workspace.plan].limits.api_access;
  const allowed = quota > 0 && (await featureEnabled("public_api", session));
  const extension = await featureEnabled("chrome_extension", session);
  const [keys, usage] = await Promise.all([
    getDb().selectFrom("api_keys").select(["id", "name", "prefix", "scopes", "created_at", "last_used_at", "revoked_at"]).where("workspace_id", "=", session.workspace.id).orderBy("created_at", "desc").limit(50).execute(),
    usageOverview(session.workspace.id, session.workspace.plan),
  ]);
  const used = usage.find((u) => u.feature === "api_access")?.used ?? 0;
  const manage = can(session.role, "api_keys.manage");
  return (
    <div className="animate-rise">
      <header className="border-b border-border bg-bg px-8 pt-9 pb-7">
        <Link href="/settings" className="text-sm text-fg-muted hover:text-fg">← {t("settings.title")}</Link>
        <h1 className="mt-2 flex items-center gap-3 text-[28px] font-semibold tracking-tight">
          <span className="grid size-10 place-items-center rounded-xl bg-bg-subtle"><KeyRound className="size-5" /></span>
          {t("api.title")}
        </h1>
        <p className="mt-2 max-w-2xl text-fg-muted">{t("api.subtitle")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <Link href="/developers" className="inline-flex items-center gap-1.5 font-medium text-accent-strong hover:underline"><BookOpen className="size-4" /> {t("api.docs")}</Link>
          <a href="/api/v1/openapi.json" className="font-mono text-xs text-fg-muted hover:text-fg">openapi.json</a>
          {allowed && <span className="text-fg-muted">{t("api.usage", { used: formatNumber(used, L), quota: formatNumber(quota, L), rate: API_RATE_PER_MINUTE })}</span>}
        </div>
      </header>
      <div className="space-y-5 bg-bg-subtle/60 p-6">
        {!allowed && (
          <Card className="max-w-3xl" data-testid="api-locked">
            <CardBody className="flex items-center gap-3">
              <Lock className="size-5 text-fg-muted" />
              <p className="flex-1 text-sm">{t("api.locked")}</p>
              <Link href="/pricing" className="text-sm font-semibold text-accent-strong hover:underline">{t("billing.upgradeCta")} →</Link>
            </CardBody>
          </Card>
        )}
        {(allowed || extension) && (
          <Card className="max-w-3xl">
            <CardHeader icon={<KeyRound />} title={t("api.keys")} hint={allowed ? t("api.keysHint") : t("api.extensionOnlyHint")} />
            <CardBody className="space-y-4">
              {manage ? (
                <CreateKeyForm
                  available={allowed ? ["read:products", "read:stores", "read:trends", "read:leads", ...(extension ? (["extension"] as const) : [])] : ["extension"]}
                  initial={allowed ? ["read:products", "read:stores", "read:trends"] : ["extension"]}
                />
              ) : (
                <p className="text-sm text-fg-muted">{t("team.noRights")}</p>
              )}
              <ul className="divide-y divide-border" data-testid="api-keys">
                {keys.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                    <span className="font-medium">{k.name}</span>
                    <code className="font-mono text-xs text-fg-muted">{k.prefix}…</code>
                    <span className="flex flex-wrap gap-1">{k.scopes.map((s) => <Badge key={s} className="font-mono text-[10px]">{s}</Badge>)}</span>
                    <span className="ml-auto text-xs text-fg-muted">{k.revoked_at ? t("api.revoked") : k.last_used_at ? t("api.lastUsed", { date: formatDateTime(k.last_used_at, L) }) : t("api.neverUsed")}</span>
                    {!k.revoked_at && manage && <RevokeKey id={k.id} />}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
