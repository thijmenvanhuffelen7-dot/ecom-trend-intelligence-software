import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { getDb, sql } from "@trendscope/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { Session } from "@/lib/auth/server";
import type { Translator } from "@/lib/i18n/translate";

/**
 * "Aan de slag": de eerste stappen die het meeste waarde geven, afgeleid uit wat de workspace al gedaan heeft.
 * Verdwijnt vanzelf zodra alles af is; geen aparte status nodig.
 */
export async function GettingStarted({ session, t }: { session: Session; t: Translator }) {
  const ws = session.workspace.id;
  const { rows } = await sql<{ shop: boolean; board: boolean; alert: boolean; ai: boolean; team: boolean }>`
    select
      exists(select 1 from watchlists where workspace_id = ${ws} and entity_type = 'store') as shop,
      exists(select 1 from board_items i join boards b on b.id = i.board_id where b.workspace_id = ${ws}) as board,
      exists(select 1 from alert_rules where workspace_id = ${ws}) as alert,
      exists(select 1 from ai_conversations where workspace_id = ${ws}) as ai,
      (select count(*) from memberships where workspace_id = ${ws}) > 1
        or exists(select 1 from workspace_invitations where workspace_id = ${ws}) as team`.execute(getDb());
  const done = rows[0]!;
  const steps = [
    { key: "shop", href: "/explorer/shops", ok: done.shop },
    { key: "board", href: "/explorer/products?sort=opportunity", ok: done.board },
    { key: "alert", href: "/alerts", ok: done.alert },
    { key: "ai", href: "/assistant", ok: done.ai },
    { key: "team", href: "/settings", ok: done.team },
  ] as const;
  const completed = steps.filter((s) => s.ok).length;
  if (completed === steps.length) return null;
  return (
    <Card data-testid="getting-started">
      <CardHeader title={t("onboarding.checklist.title")} hint={t("onboarding.checklist.progress", { done: completed, total: steps.length })} />
      <CardBody>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-bg-subtle">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(completed / steps.length) * 100}%` }} />
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {steps.map((s) => (
            <li key={s.key}>
              <Link href={s.href} className="flex h-full items-start gap-2.5 rounded-xl border border-border p-3 text-sm transition hover:bg-surface-hover" aria-label={`${t(`onboarding.checklist.${s.key}.title`)}${s.ok ? " ✓" : ""}`}>
                {s.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent-strong" /> : <Circle className="mt-0.5 size-4 shrink-0 text-fg-subtle" />}
                <span>
                  <span className={s.ok ? "font-medium text-fg-muted line-through" : "font-medium"}>{t(`onboarding.checklist.${s.key}.title`)}</span>
                  <span className="mt-0.5 block text-xs text-fg-muted">{t(`onboarding.checklist.${s.key}.body`)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
