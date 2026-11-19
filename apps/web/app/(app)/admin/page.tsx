import { notFound } from "next/navigation";
import { Database, Scale, Shield } from "lucide-react";
import { getDb } from "@trendscope/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  const session = await requireSession();
  if (session.role === "member" && !session.user.isPlatformAdmin) notFound();
  const t = await getT();
  const db = getDb();
  const [connectors, weights] = await Promise.all([
    db.selectFrom("connectors").selectAll().orderBy("enabled", "desc").orderBy("id").execute(),
    db.selectFrom("score_weights").selectAll().where("is_active", "=", true).executeTakeFirst(),
  ]);
  const w = (weights?.weights ?? {}) as Record<string, number>;
  const maxW = Math.max(...Object.values(w), 1);
  const now = Date.now();

  return (
    <div className="animate-rise">
      <header className="border-b border-border bg-bg px-8 pt-9 pb-7">
        <h1 className="flex items-center gap-3 text-[28px] font-semibold tracking-tight">
          <span className="grid size-10 place-items-center rounded-xl bg-bg-subtle">
            <Shield className="size-5" />
          </span>
          {t("admin.title")}
        </h1>
      </header>
      <div className="grid gap-5 bg-bg-subtle/60 p-6 xl:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader icon={<Database />} title={t("admin.connectors")} />
          <table className="w-full text-sm">
            <thead className="border-y border-border bg-bg-subtle/50 text-left text-fg-muted">
              <tr>
                <th className="px-5 py-3 font-medium">{t("admin.connector")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.kind")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.legal")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.status")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.lastSuccess")}</th>
              </tr>
            </thead>
            <tbody>
              {connectors.map((c) => {
                const fresh = c.last_success_at && now - c.last_success_at.getTime() < c.freshness_sla_hours * 3_600_000;
                return (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3">
                      <p className="font-semibold">{c.display_name}</p>
                      <p className="font-mono text-xs text-fg-subtle">{c.id}</p>
                    </td>
                    <td className="px-5 py-3 text-fg-muted">{c.kind}</td>
                    <td className="px-5 py-3">
                      <Badge tone={c.legal_review === "approved" ? "accent" : c.legal_review === "rejected" ? "danger" : "warning"}>{c.legal_review}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={!c.enabled ? "neutral" : fresh ? "accent" : "danger"}>
                        <span className={`size-1.5 rounded-full ${!c.enabled ? "bg-fg-subtle" : fresh ? "bg-accent" : "bg-danger"}`} />
                        {c.enabled ? t("admin.enabled") : t("admin.disabled")}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-fg-muted">{c.last_success_at ? formatDate(c.last_success_at, t.locale) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
      </div>
    </div>
  );
}
