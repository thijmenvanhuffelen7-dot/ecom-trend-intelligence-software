import Link from "next/link";
import { ExternalLink, Send } from "lucide-react";
import { getDb } from "@trendscope/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { Session } from "@/lib/auth/server";
import type { Translator } from "@/lib/i18n/translate";
import { formatDateTime } from "@/lib/utils";
import { featureEnabled } from "@/server/flags";
import { ConnectShopify, DisconnectShopify, PushToStore } from "./shopify-controls";

/** "Naar mijn winkel": alleen met de feature flag (Pro/Business); zonder koppeling een link naar de instellingen. */
export async function PushCard({ session, t, clusterId, defaults }: { session: Session; t: Translator; clusterId: number; defaults: { title: string; description: string; price: number } }) {
  if (!(await featureEnabled("push_to_store", session))) return null;
  const db = getDb();
  const [connections, pushes] = await Promise.all([
    db.selectFrom("shop_connections").select(["id", "shop_domain", "shop_name", "mode"]).where("workspace_id", "=", session.workspace.id).orderBy("created_at").execute(),
    db
      .selectFrom("store_pushes as p")
      .innerJoin("shop_connections as c", "c.id", "p.connection_id")
      .select(["p.id", "p.status", "p.remote_admin_url", "p.error", "p.created_at", "c.shop_domain"])
      .where("p.workspace_id", "=", session.workspace.id)
      .where("p.cluster_id", "=", String(clusterId))
      .orderBy("p.created_at", "desc")
      .limit(5)
      .execute(),
  ]);
  return (
    <Card data-testid="push-card">
      <CardHeader icon={<Send />} title={t("shopify.cardTitle")} hint={t("shopify.cardHint")} action={connections.some((c) => c.mode === "mock") ? <Badge tone="warning">{t("shopify.mockBadge")}</Badge> : undefined} />
      <CardBody className="space-y-4">
        {connections.length ? (
          <PushToStore clusterId={clusterId} connections={connections.map((c) => ({ id: c.id, label: c.shop_name ? `${c.shop_name} (${c.shop_domain})` : c.shop_domain }))} defaults={defaults} />
        ) : (
          <p className="text-sm text-fg-muted">
            {t("shopify.noConnection")} <Link href="/settings#integrations" className="font-medium text-accent-strong hover:underline">{t("shopify.connectCta")} →</Link>
          </p>
        )}
        {pushes.length > 0 && (
          <ul className="divide-y divide-border border-t border-border text-sm" data-testid="push-history">
            {pushes.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <Badge tone={p.status === "created" ? "accent" : "danger"}>{t(`shopify.status.${p.status as "created"}`)}</Badge>
                <span className="flex-1 truncate text-fg-muted">{p.shop_domain} · {formatDateTime(p.created_at, t.locale)}{p.error ? ` · ${p.error}` : ""}</span>
                {p.remote_admin_url && <a href={p.remote_admin_url} target="_blank" rel="noreferrer noopener" className="text-fg-muted hover:text-fg" aria-label={t("shopify.openInShopify")}><ExternalLink className="size-4" /></a>}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export async function IntegrationsSection({ session, t }: { session: Session; t: Translator }) {
  if (!(await featureEnabled("push_to_store", session))) return null;
  const connections = await getDb().selectFrom("shop_connections").select(["id", "shop_domain", "shop_name", "mode", "last_used_at", "last_error"]).where("workspace_id", "=", session.workspace.id).orderBy("created_at").execute();
  const manage = session.role !== "member";
  return (
    <Card className="max-w-2xl" id="integrations" data-testid="integrations">
      <CardHeader icon={<Send />} title={t("shopify.integrations")} hint={t("shopify.integrationsHint")} />
      <CardBody className="space-y-4">
        <ul className="divide-y divide-border">
          {connections.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <span className="font-medium">{c.shop_name ?? c.shop_domain}</span>
              <span className="text-xs text-fg-muted">{c.shop_domain}</span>
              {c.mode === "mock" && <Badge tone="warning">{t("shopify.mockBadge")}</Badge>}
              {c.last_error && <span className="text-xs text-danger">{c.last_error}</span>}
              <span className="ml-auto">{manage && <DisconnectShopify id={c.id} />}</span>
            </li>
          ))}
        </ul>
        {manage ? <ConnectShopify /> : <p className="text-sm text-fg-muted">{t("team.noRights")}</p>}
      </CardBody>
    </Card>
  );
}
