"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { deleteWorkspace } from "@/server/actions/workspace";

export function DeleteWorkspace({ name }: { name: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(async (_: unknown, form: FormData) => (await deleteWorkspace(form)) ?? null, null);
  return (
    <form action={action} className="space-y-2" data-testid="delete-workspace">
      <p className="text-sm text-fg-muted">{t("workspace.deleteBody", { name })}</p>
      <div className="flex flex-wrap gap-2">
        <Input name="confirm" placeholder={name} aria-label={t("workspace.confirmLabel")} autoComplete="off" className="min-w-[200px] flex-1" />
        <Button type="submit" variant="outline" disabled={pending} className="border-danger/50 text-danger hover:bg-danger/10"><Trash2 className="size-4" /> {t("workspace.delete")}</Button>
      </div>
      {state && !state.ok && <p className="text-sm text-danger" role="alert">{t(`workspace.errors.${state.error as "confirm"}`)}</p>}
    </form>
  );
}
