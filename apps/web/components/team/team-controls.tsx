"use client";

import { useState, useTransition } from "react";
import { Copy, Send, Trash2, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { acceptInvite, inviteMember, removeMember, revokeInvite, switchWorkspace } from "@/server/actions/team";

export function InviteForm({ disabled }: { disabled: boolean }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ link?: string; error?: string } | null>(null);
  return (
    <form
      className="space-y-2"
      data-testid="invite-form"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await inviteMember({ email, role });
          setResult(r.ok ? { link: r.link } : { error: r.error });
          if (r.ok) setEmail("");
        });
      }}
    >
      <div className="flex flex-wrap gap-2">
        <Input type="email" required placeholder="collega@bedrijf.nl" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-[220px] flex-1" aria-label={t("team.email")} disabled={disabled} />
        <select className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")} aria-label={t("team.role")} disabled={disabled}>
          <option value="member">{t("team.roles.member")}</option>
          <option value="admin">{t("team.roles.admin")}</option>
        </select>
        <Button type="submit" variant="accent" disabled={pending || disabled}><Send className="size-4" /> {t("team.invite")}</Button>
      </div>
      {result?.error && <p className="text-sm text-danger" role="alert">{t(`team.errors.${result.error as "limit"}`)}</p>}
      {result?.link && (
        <div className="flex items-center gap-2 rounded-lg bg-bg-subtle px-3 py-2 text-xs" role="status">
          <span className="flex-1 truncate font-mono" data-testid="invite-link">{result.link}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(result.link!)}><Copy className="size-3.5" /> {t("team.copy")}</Button>
        </div>
      )}
    </form>
  );
}

export function RevokeInvite({ id }: { id: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return <Button size="icon" variant="ghost" aria-label={t("team.revoke")} disabled={pending} onClick={() => start(async () => void (await revokeInvite(id)))}><Trash2 className="size-4" /></Button>;
}

export function RemoveMember({ userId }: { userId: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <Button size="icon" variant="ghost" aria-label={t("team.remove")} disabled={pending} onClick={() => { if (confirm(t("team.removeConfirm"))) start(async () => void (await removeMember(userId))); }}>
      <UserMinus className="size-4" />
    </Button>
  );
}

export function SwitchWorkspace({ id, label }: { id: string; label: string }) {
  const [pending, start] = useTransition();
  return <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => await switchWorkspace(id))}>{label}</Button>;
}

export function AcceptInvite({ token }: { token: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Button variant="accent" disabled={pending} onClick={() => start(async () => { const r = await acceptInvite(token); if (r && !r.ok) setError(r.error); })}>{t("team.accept")}</Button>
      {error && <p className="text-sm text-danger" role="alert">{t(`team.errors.${error as "limit"}`)}</p>}
    </div>
  );
}
