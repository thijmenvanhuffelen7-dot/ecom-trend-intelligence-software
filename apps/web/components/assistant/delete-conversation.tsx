"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { deleteConversation } from "@/server/actions/ai";

export function DeleteConversation({ id, active }: { id: string; active: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label={t("assistant.delete")}
      disabled={pending}
      className="grid size-7 shrink-0 place-items-center rounded-md text-fg-subtle opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-surface-hover hover:text-danger"
      onClick={() => {
        if (!confirm(t("assistant.deleteConfirm"))) return;
        start(async () => {
          await deleteConversation(id);
          if (active) router.push("/assistant");
        });
      }}
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}
