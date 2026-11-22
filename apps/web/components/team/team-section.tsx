import Link from "next/link";
import { Users } from "lucide-react";
import { can, PLANS } from "@trendscope/core";
import { getDb, sql } from "@trendscope/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { Session } from "@/lib/auth/server";
import type { Translator } from "@/lib/i18n/translate";
import { formatDate } from "@/lib/utils";
import { DeleteWorkspace } from "./delete-workspace";
import { InviteForm, RemoveMember, RevokeInvite, SwitchWorkspace } from "./team-controls";

export async function TeamSection({ session, t }: { session: Session; t: Translator }) {
  const db = getDb();
  const [members, invites, workspaces] = await Promise.all([
    db
      .selectFrom("memberships as m")
      .innerJoin("users as u", "u.id", "m.user_id")
      .select(["u.id", "u.email", "u.name", "m.role", "m.created_at"])
      .where("m.workspace_id", "=", session.workspace.id)
      .orderBy(sql`case m.role when 'owner' then 0 when 'admin' then 1 else 2 end`)
      .orderBy("u.email")
      .execute(),
    db
      .selectFrom("workspace_invitations")
      .select(["id", "email", "role", "expires_at"])
      .where("workspace_id", "=", session.workspace.id)
      .where("accepted_at", "is", null)
      .where("revoked_at", "is", null)
      .where("expires_at", ">", new Date())
      .orderBy("created_at", "desc")
      .execute(),
    db
      .selectFrom("memberships as m")
      .innerJoin("workspaces as w", "w.id", "m.workspace_id")
      .select(["w.id", "w.name", "w.plan", "m.role"])
      .where("m.user_id", "=", session.user.id)
      .orderBy("m.created_at")
      .execute(),
  ]);
  const limit = PLANS[session.workspace.plan].limits.seats;
  const used = members.length + invites.length;
  const mayInvite = can(session.role, "members.invite");
  const mayRemove = can(session.role, "members.remove");
  return (
    <>
      <Card className="max-w-2xl" data-testid="team-section">
        <CardHeader icon={<Users />} title={t("team.title")} hint={t("team.hint", { used, limit })} />
        <CardBody className="space-y-4">
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="flex-1 truncate">{m.email}{m.id === session.user.id ? ` (${t("team.you")})` : ""}</span>
                <Badge>{t(`team.roles.${m.role}`)}</Badge>
                {mayRemove && m.role !== "owner" && m.id !== session.user.id && <RemoveMember userId={m.id} />}
              </li>
            ))}
          </ul>
          {invites.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium tracking-wide text-fg-muted uppercase">{t("team.pending")}</p>
              <ul className="divide-y divide-border">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 py-2 text-sm" data-testid="pending-invite">
                    <span className="flex-1 truncate">{i.email}</span>
                    <span className="text-xs text-fg-muted">{t("team.expires", { date: formatDate(i.expires_at, t.locale) })}</span>
                    <Badge>{t(`team.roles.${i.role}`)}</Badge>
                    {mayInvite && <RevokeInvite id={i.id} />}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!mayInvite ? (
            <p className="text-sm text-fg-muted">{t("team.noRights")}</p>
          ) : used >= limit ? (
            <p className="text-sm text-fg-muted" data-testid="seats-full">
              {t("team.upgradeForSeats")} <Link href="/pricing" className="font-medium text-accent-strong hover:underline">{t("billing.upgradeCta")} →</Link>
            </p>
          ) : (
            <InviteForm disabled={false} />
          )}
        </CardBody>
      </Card>
      {session.role === "owner" && (
        <Card className="max-w-2xl border-danger/30">
          <CardHeader title={t("workspace.dangerTitle")} />
          <CardBody><DeleteWorkspace name={session.workspace.name} /></CardBody>
        </Card>
      )}
      {workspaces.length > 1 && (
        <Card className="max-w-2xl">
          <CardHeader title={t("team.workspaces")} />
          <CardBody>
            <ul className="divide-y divide-border">
              {workspaces.map((w) => (
                <li key={w.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="flex-1 truncate font-medium">{w.name}</span>
                  <Badge>{t(`billing.plans.${w.plan}`)}</Badge>
                  <Badge>{t(`team.roles.${w.role}`)}</Badge>
                  {w.id === session.workspace.id ? <Badge tone="accent">{t("team.currentWs")}</Badge> : <SwitchWorkspace id={w.id} label={t("team.switch")} />}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}
