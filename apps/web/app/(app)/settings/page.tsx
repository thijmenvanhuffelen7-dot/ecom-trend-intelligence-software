import Link from "next/link";
import { cookies } from "next/headers";
import { Settings } from "lucide-react";
import { PLANS } from "@trendscope/core";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/preference-switch";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { TeamSection } from "@/components/team/team-section";
import { IntegrationsSection } from "@/components/shopify/push-card";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireSession();
  const t = await getT();
  const theme = (await cookies()).get("ts_theme")?.value === "dark" ? "dark" : "light";
  const plan = PLANS[session.workspace.plan];
  const rows: [string, React.ReactNode][] = [
    [t("settings.workspace"), session.workspace.name],
    [t("settings.plan"), <span key="p" className="flex items-center gap-2"><Badge tone="accent" className="capitalize">{plan.id}</Badge><Link href="/settings/billing" className="text-sm font-medium text-accent-strong hover:underline">{t("billing.title")} →</Link></span>],
    [t("api.title"), <Link key="api" href="/settings/api" className="text-sm font-medium text-accent-strong hover:underline">{t("api.keys")} →</Link>],
    [t("settings.role"), <Badge key="r" className="capitalize">{session.role}</Badge>],
    [t("settings.language"), <Segmented key="l" kind="locale" value={t.locale} options={[{ value: "nl", label: "Nederlands" }, { value: "en", label: "English" }]} />],
    [t("settings.theme"), <Segmented key="t" kind="theme" value={theme} options={[{ value: "light", label: t("settings.light") }, { value: "dark", label: t("settings.dark") }]} />],
  ];
  return (
    <div className="animate-rise">
      <header className="border-b border-border bg-bg px-8 pt-9 pb-7">
        <h1 className="flex items-center gap-3 text-[28px] font-semibold tracking-tight">
          <span className="grid size-10 place-items-center rounded-xl bg-bg-subtle">
            <Settings className="size-5" />
          </span>
          {t("settings.title")}
        </h1>
        <p className="mt-2 text-fg-muted">{session.user.email}</p>
      </header>
      <div className="space-y-5 bg-bg-subtle/60 p-6">
        <Card className="max-w-2xl divide-y divide-border">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 px-5 py-4">
              <span className="text-sm text-fg-muted">{k}</span>
              <span className="text-sm font-medium">{v}</span>
            </div>
          ))}
        </Card>
        <TeamSection session={session} t={t} />
        <IntegrationsSection session={session} t={t} />
      </div>
    </div>
  );
}
