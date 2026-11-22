import Link from "next/link";
import { Bell, BellRing, Mail, Plug, Settings2 } from "lucide-react";
import { getDb } from "@trendscope/db";
import { ChannelForm } from "@/components/alerts/channel-form";
import { DeleteButton, DigestSelect, EvaluateButton, MarkReadButton, RuleToggle } from "@/components/alerts/actions";
import { RuleBuilder } from "@/components/alerts/rule-builder";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Alerts" };
export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const session = await requireSession();
  const t = await getT();
  const L = t.locale;
  const db = getDb();
  const ws = session.workspace.id;
  const [rules, channels, events, niches, me] = await Promise.all([
    db.selectFrom("alert_rules").selectAll().where("workspace_id", "=", ws).orderBy("created_at", "desc").execute(),
    db.selectFrom("notification_channels").select(["id", "name", "type", "target_hint", "last_error", "last_used_at"]).where("workspace_id", "=", ws).orderBy("created_at").execute(),
    db.selectFrom("alert_events").select(["id", "title", "payload", "triggered_at", "read_at"]).where("workspace_id", "=", ws).orderBy("triggered_at", "desc").limit(60).execute(),
    db.selectFrom("niches").select(["slug", "name_nl", "name_en"]).orderBy("name_en").execute(),
    db.selectFrom("users").select("digest").where("id", "=", session.user.id).executeTakeFirst(),
  ]);
  const unread = events.filter((e) => !e.read_at).length;

  return (
    <div className="animate-rise">
      <header className="border-b border-border bg-bg px-8 pt-9 pb-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-[28px] font-semibold tracking-tight">
              <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-strong"><BellRing className="size-5" /></span>
              {t("alerts.title")}
            </h1>
            <p className="mt-2 max-w-2xl text-fg-muted">{t("alerts.subtitle")}</p>
          </div>
          <EvaluateButton />
        </div>
      </header>
      <div className="grid gap-5 bg-bg-subtle/60 p-6 xl:grid-cols-[1.1fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader icon={<Bell />} title={t("alerts.newRule")} />
            <CardBody>
              <RuleBuilder channels={channels} niches={niches.map((n) => ({ slug: n.slug, label: L === "nl" ? n.name_nl : n.name_en }))} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<Settings2 />} title={t("alerts.rules")} action={<Badge>{rules.length}</Badge>} />
            {rules.length === 0 ? (
              <CardBody><p className="text-sm text-fg-muted">{t("alerts.noRules")}</p></CardBody>
            ) : (
              <ul className="divide-y divide-border border-t border-border" data-testid="rule-list">
                {rules.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{r.name}</p>
                      <p className="text-xs text-fg-muted">
                        {t(`alerts.kinds.${(r.rule as { kind: "score_threshold" }).kind}`)} ·{" "}
                        {r.last_triggered_at ? t("alerts.lastTriggered", { when: formatDateTime(r.last_triggered_at, L) }) : t("alerts.never")}
                      </p>
                    </div>
                    <RuleToggle id={r.id} enabled={r.enabled} />
                    <DeleteButton id={r.id} kind="rule" />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader icon={<Plug />} title={t("alerts.integrations")} hint={t("alerts.integrationsHint")} />
            <CardBody className="space-y-4">
              {channels.length > 0 && (
                <ul className="divide-y divide-border rounded-xl border border-border" data-testid="channel-list">
                  {channels.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
                      <Badge tone="outline">{t(`alerts.channelTypes.${c.type as "slack"}`)}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{c.name}</p>
                        <p className="truncate text-xs text-fg-muted">{c.target_hint}{c.last_error && <span className="ml-2 text-danger">{t("alerts.lastError", { error: c.last_error })}</span>}</p>
                      </div>
                      <DeleteButton id={c.id} kind="channel" />
                    </li>
                  ))}
                </ul>
              )}
              <ChannelForm />
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<Mail />} title={t("alerts.digest")} hint={t("alerts.digestHint")} action={<DigestSelect value={(me?.digest as "weekly") ?? "weekly"} />} />
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader icon={<BellRing />} title={t("alerts.feed")} action={unread > 0 ? <span className="flex items-center gap-2"><Badge tone="accent">{unread}</Badge><MarkReadButton /></span> : undefined} />
          {events.length === 0 ? (
            <CardBody><p className="text-sm text-fg-muted">{t("alerts.noEvents")}</p></CardBody>
          ) : (
            <ul className="divide-y divide-border border-t border-border" data-testid="alert-feed">
              {events.map((e) => {
                const p = e.payload as { url?: string; rule?: string; title?: { nl: string; en: string } };
                return (
                  <li key={e.id}>
                    <Link href={p.url ?? "#"} className={cn("flex gap-3 px-5 py-3 hover:bg-surface-hover", !e.read_at && "bg-accent-soft/30")}>
                      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", e.read_at ? "bg-border-strong" : "bg-accent")} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{p.title?.[L] ?? e.title}</p>
                        <p className="text-xs text-fg-muted">{p.rule} · {formatDateTime(e.triggered_at, L)}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
