import { createHash } from "node:crypto";
import Link from "next/link";
import { getDb } from "@trendscope/db";
import { AcceptInvite } from "@/components/team/team-controls";
import { LogoMark } from "@/components/shell/logo";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Uitnodiging", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Niet publiek: zonder sessie stuurt de middleware je eerst naar login (met ?next= terug hierheen). */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const session = await requireSession();
  const t = await getT();
  const { token } = await params;
  const valid = /^[A-Za-z0-9_-]{20,64}$/.test(token);
  const inv = valid
    ? await getDb()
        .selectFrom("workspace_invitations as i")
        .innerJoin("workspaces as w", "w.id", "i.workspace_id")
        .leftJoin("users as u", "u.id", "i.invited_by")
        .select(["i.email", "i.role", "i.expires_at", "i.accepted_at", "i.revoked_at", "w.name as workspace", "u.email as inviter"])
        .where("i.token_hash", "=", createHash("sha256").update(token).digest("hex"))
        .executeTakeFirst()
    : undefined;
  const error = !inv || inv.revoked_at ? "invalid" : inv.accepted_at ? "used" : new Date(inv.expires_at) < new Date() ? "expired" : inv.email !== session.user.email.toLowerCase() ? "wrong_email" : null;
  return (
    <div className="grid min-h-dvh place-items-center bg-bg-subtle/60 px-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-8 shadow-pop" data-testid="invite-page">
        <Link href="/home" className="mb-6 flex items-center gap-2 font-semibold"><LogoMark /> Trendscope</Link>
        {error || !inv ? (
          <>
            <h1 className="text-xl font-semibold">{t("team.title")}</h1>
            <p className="mt-2 text-sm text-danger" role="alert">{t(`team.errors.${error ?? "invalid"}`)}</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">{t("team.inviteTitle", { workspace: inv.workspace })}</h1>
            <p className="mt-2 mb-6 text-sm text-fg-muted">
              {t("team.inviteBody", { inviter: inv.inviter ?? "—", workspace: inv.workspace, role: t(`team.roles.${inv.role}`).toLowerCase() })}
            </p>
            <AcceptInvite token={token} />
          </>
        )}
      </div>
    </div>
  );
}
