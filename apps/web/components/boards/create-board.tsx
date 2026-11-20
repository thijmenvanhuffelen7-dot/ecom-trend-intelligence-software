"use client";

import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { createBoard } from "@/server/actions/boards";

export function CreateBoard() {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const board = await createBoard({ name });
          setName("");
          router.push(`/boards/${board.id}`);
        });
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("boards.namePlaceholder")} className="h-10 w-64 rounded-xl border border-border bg-surface px-3 text-sm shadow-sm focus:ring-2 focus:ring-accent/25 focus:outline-none" />
      <button disabled={!name.trim() || pending} className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg shadow-sm disabled:opacity-50">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} {t("boards.new")}
      </button>
    </form>
  );
}
