import { notFound } from "next/navigation";
import { AlertTriangle, Boxes, CheckCircle2, Database, ListOrdered, Radar, Scale, Shield } from "lucide-react";
import { getDb, sql } from "@trendscope/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

async function loadAdmin() {
  const db = getDb();
  const [connectors, weights, queue, candidates, recentCandidates, failures, clustering] = await Promise.all([
    db
      .selectFrom("connectors as c")
      .selectAll("c")
      .select([
        sql<number>`(select count(*)::int from crawl_jobs j where j.connector_id = c.id and j.started_at > now() - interval '24 hours')`.as("jobs"),
        sql<number>`(select count(*)::int from crawl_jobs j where j.connector_id = c.id and j.started_at > now() - interval '24 hours' and j.status = 'failed')`.as("errors"),
        sql<number | null>`(select avg(duration_ms)::int from crawl_jobs j where j.connector_id = c.id and j.started_at > now() - interval '24 hours')`.as("avg_ms"),
        sql<number>`(select count(*)::int from crawl_targets t where t.connector_id = c.id)`.as("targets"),
      ])
      .orderBy("c.enabled", "desc")
      .orderBy("c.id")
      .execute(),
    db.selectFrom("score_weights").selectAll().where("is_active", "=", true).executeTakeFirst(),
    sql<{ due: number; leased: number; scheduled: number; dead: number; hot: number; daily: number; sleepy: number }>`
      select
        count(*) filter (where next_run_at <= now() and (leased_until is null or leased_until < now()))::int as due,
        count(*) filter (where leased_until > now())::int as leased,
        count(*) filter (where next_run_at > now())::int as scheduled,
        count(*) filter (where failures >= 5)::int as dead,
        count(*) filter (where interval_secs <= 21600)::int as hot,
        count(*) filter (where interval_secs > 21600 and interval_secs <= 86400)::int as daily,
        count(*) filter (where interval_secs > 86400)::int as sleepy
      from crawl_targets`.execute(db),
    db.selectFrom("store_candidates").select(["status", "source", sql<number>`count(*)::int`.as("n")]).groupBy(["status", "source"]).execute(),
    db.selectFrom("store_candidates").select(["domain", "status", "platform", "source", "discovered_at", "probed_at"]).orderBy("discovered_at", "desc").limit(8).execute(),
    db
      .selectFrom("crawl_jobs")
      .select(["id", "connector_id", "target", "error", "started_at", "attempt", "dead_letter"])
      .where("status", "=", "failed")
      .where("started_at", ">", sql<Date>`now() - interval '24 hours'`)
      .orderBy("started_at", "desc")
      .limit(10)
      .execute(),
    sql<{ products: number; clustered: number; pending: number; orphans: number; clusters: number; auto: number; multi: number; merges: number }>`
      select
        (select count(*)::int from products where status <> 'removed') as products,
        (select count(*)::int from products p where exists (select 1 from cluster_members m where m.product_id = p.id)) as clustered,
        (select count(*)::int from products where clustered_at is null and status <> 'removed') as pending,
        (select count(*)::int from products p where clustered_at is not null and status <> 'removed'
           and not exists (select 1 from cluster_members m where m.product_id = p.id)) as orphans,
        (select count(*)::int from product_clusters) as clusters,
        (select count(*)::int from product_clusters where created_by = 'clustering') as auto,
        (select count(*)::int from product_clusters where source_count >= 2) as multi,
        (select count(*)::int from cluster_merges) as merges`.execute(db),
  ]);
  return { connectors, weights, queue: queue.rows[0]!, candidates, recentCandidates, failures, clustering: clustering.rows[0]! };
}

export default async function AdminPage() {
  const session = await requireSession();
  if (session.role === "member" && !session.user.isPlatformAdmin) notFound();
  const t = await getT();
  const L = t.locale;
  const { connectors, weights, queue, candidates, recentCandidates, failures, clustering } = await loadAdmin();
  const w = (weights?.weights ?? {}) as Record<string, number>;
  const maxW = Math.max(...Object.values(w), 1);
  const now = Date.now();
  const cand = (status: string) => candidates.filter((c) => c.status === status).reduce((a, c) => a + c.n, 0);

  return (
    <div className="animate-rise">
      <header className="border-b border-border bg-bg px-8 pt-9 pb-7">
        <h1 className="flex items-center gap-3 text-[28px] font-semibold tracking-tight">
          <span className="grid size-10 place-items-center rounded-xl bg-bg-subtle">
            <Shield className="size-5" />
          </span>
          {t("admin.title")}
        </h1>
        <div className="mt-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {(
            [
              [t("admin.dueNow"), queue.due, "text-fg"],
              [t("admin.leased"), queue.leased, "text-info"],
              [t("admin.scheduled"), queue.scheduled, "text-fg"],
              [t("admin.deadLetters"), queue.dead, queue.dead ? "text-danger" : "text-fg"],
              ["6u / 24u / 3d", `${queue.hot} · ${queue.daily} · ${queue.sleepy}`, "text-fg"],
              [t("admin.candidates"), `${cand("accepted")} / ${cand("new") + cand("accepted") + cand("rejected") + cand("error")}`, "text-accent-strong"],
            ] as const
          ).map(([k, v, cls]) => (
            <div key={k} className="rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm">
              <p className={cn("tabular text-2xl font-semibold tracking-tight", cls)}>{typeof v === "number" ? formatNumber(v, L) : v}</p>
              <p className="text-xs text-fg-muted">{k}</p>
            </div>
          ))}
        </div>
      </header>

      <div className="grid gap-5 p-6 xl:grid-cols-[1.7fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader icon={<Database />} title={t("admin.freshness")} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-border bg-bg-subtle/50 text-left text-fg-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">{t("admin.connector")}</th>
                  <th className="px-4 py-3 font-medium">{t("admin.legal")}</th>
                  <th className="px-4 py-3 font-medium">{t("admin.status")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("admin.jobs24h")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("admin.successRate")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("admin.avgDuration")}</th>
                  <th className="px-5 py-3 font-medium">{t("admin.lastSuccess")}</th>
                </tr>
              </thead>
              <tbody>
                {connectors.map((c) => {
                  const fresh = !!c.last_success_at && now - c.last_success_at.getTime() < c.freshness_sla_hours * 3_600_000;
                  const rate = c.jobs ? Math.round(((c.jobs - c.errors) / c.jobs) * 100) : null;
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-3">
                        <p className="font-semibold">{c.display_name}</p>
                        <p className="font-mono text-xs text-fg-subtle">
                          {c.id}
                          {c.targets ? ` · ${formatNumber(c.targets, L)} targets` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={c.legal_review === "approved" ? "accent" : c.legal_review === "rejected" ? "danger" : "warning"}>{c.legal_review}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {!c.enabled ? (
                          <Badge>{t("admin.disabled")}</Badge>
                        ) : (
                          <Badge tone={fresh ? "accent" : "danger"}>
                            <span className={`size-1.5 rounded-full ${fresh ? "bg-accent" : "bg-danger"}`} />
                            {fresh ? t("admin.fresh") : t("admin.stale")}
                          </Badge>
                        )}
                      </td>
                      <td className="tabular px-4 py-3 text-right">{formatNumber(c.jobs, L)}</td>
                      <td className={cn("tabular px-4 py-3 text-right font-semibold", rate !== null && rate < 95 && "text-danger")}>{rate === null ? "—" : `${rate}%`}</td>
                      <td className="tabular px-4 py-3 text-right text-fg-muted">{c.avg_ms != null ? `${c.avg_ms} ms` : "—"}</td>
                      <td className="px-5 py-3 text-fg-muted">{formatDateTime(c.last_success_at, L)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader icon={<Scale />} title={t("admin.weights")} action={<Badge>v{weights?.version}</Badge>} />
          <CardBody className="space-y-3">
            {Object.entries(w).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[130px_1fr_40px] items-center gap-3 text-sm">
                <span>{t(`signals.${k as "store"}`)}</span>
                <div className="h-2 overflow-hidden rounded-full bg-bg-subtle">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(v / maxW) * 100}%` }} />
                </div>
                <span className="tabular text-right font-semibold">{v}</span>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card data-testid="clustering-stats">
          <CardHeader icon={<Boxes />} title={t("admin.clustering")} />
          <CardBody className="space-y-4">
            <div>
              <div className="mb-1.5 flex justify-between text-sm">
                <span className="text-fg-muted">{t("admin.clusteredShare")}</span>
                <span className="tabular font-semibold">{Math.round((clustering.clustered / Math.max(1, clustering.products)) * 100)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-bg-subtle">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(clustering.clustered / Math.max(1, clustering.products)) * 100}%` }} />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {(
                [
                  [t("admin.clusters"), clustering.clusters],
                  [t("admin.autoClusters"), clustering.auto],
                  [t("admin.multiSource"), clustering.multi],
                  [t("admin.merges"), clustering.merges],
                  [t("admin.pendingClustering"), clustering.pending],
                  [t("admin.orphans"), clustering.orphans],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-bg-subtle px-3 py-2">
                  <dd className="tabular text-lg font-semibold">{formatNumber(v, L)}</dd>
                  <dt className="text-xs text-fg-muted">{k}</dt>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon={<Radar />} title={t("admin.candidates")} />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {recentCandidates.map((c) => (
              <li key={c.domain} className="flex items-center gap-3 px-5 py-2.5">
                <span className="min-w-0 flex-1 truncate font-medium">{c.domain}</span>
                <span className="text-xs text-fg-subtle">{c.source}</span>
                {c.platform && <span className="text-xs text-fg-muted capitalize">{c.platform}</span>}
                <Badge tone={c.status === "accepted" ? "accent" : c.status === "rejected" ? "neutral" : c.status === "error" ? "danger" : "info"}>{c.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader icon={<ListOrdered />} title={t("admin.recentFailures")} />
          {failures.length === 0 ? (
            <p className="flex items-center gap-2 px-5 pb-5 text-sm text-fg-muted">
              <CheckCircle2 className="size-4 text-accent" /> {t("admin.noFailures")}
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border text-sm">
              {failures.map((f) => (
                <li key={f.id} className="px-5 py-2.5">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={cn("size-4", f.dead_letter ? "text-danger" : "text-warning")} />
                    <span className="font-medium">{f.target}</span>
                    <span className="text-xs text-fg-subtle">#{f.attempt}</span>
                    {f.dead_letter && <Badge tone="danger">dead letter</Badge>}
                    <span className="ml-auto text-xs text-fg-subtle">{formatDateTime(f.started_at, L)}</span>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-fg-muted">{f.error}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
