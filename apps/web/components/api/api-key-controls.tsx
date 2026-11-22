"use client";

import { useState, useTransition } from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { createApiKey, revokeApiKey } from "@/server/actions/api-keys";

type Scope = "read:products" | "read:stores" | "read:trends" | "read:leads" | "extension";

export function CreateKeyForm({ available, initial }: { available: Scope[]; initial: Scope[] }) {
  const t = useT();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(initial);
  const [pending, start] = useTransition();
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3" data-testid="create-key">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createApiKey({ name, scopes });
            if (r.ok) { setKey(r.key); setName(""); setError(null); } else setError(r.error);
          });
        }}
      >
        <Input required minLength={2} maxLength={60} placeholder={t("api.keyName")} aria-label={t("api.keyName")} value={name} onChange={(e) => setName(e.target.value)} className="min-w-[200px] flex-1" />
        {available.length > 1 && available.map((s) => (
          <label key={s} className="inline-flex items-center gap-1 font-mono text-xs">
            <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} /> {s}
          </label>
        ))}
        <Button type="submit" variant="accent" disabled={pending || !scopes.length}><KeyRound className="size-4" /> {t("api.create")}</Button>
      </form>
      {error && <p className="text-sm text-danger" role="alert">{t(`api.errors.${error as "plan"}`)}</p>}
      {key && (
        <div className="space-y-1.5 rounded-xl border border-warning/40 bg-warning-soft p-3" role="status">
          <p className="text-sm font-medium">{t("api.copyNow")}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-surface px-2 py-1 font-mono text-xs" data-testid="new-key">{key}</code>
            <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(key)}><Copy className="size-3.5" /> {t("team.copy")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RevokeKey({ id }: { id: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <Button size="icon" variant="ghost" aria-label={t("api.revoke")} disabled={pending} onClick={() => { if (confirm(t("api.revokeConfirm"))) start(async () => void (await revokeApiKey(id))); }}>
      <Trash2 className="size-4" />
    </Button>
  );
}
