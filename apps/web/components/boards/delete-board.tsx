"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteBoard } from "@/server/actions/boards";

export function DeleteBoardButton({ boardId, label }: { boardId: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (!confirm(`${label}?`)) return;
        start(async () => {
          await deleteBoard({ boardId });
          router.push("/boards");
        });
      }}
      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm font-medium text-danger shadow-sm hover:bg-danger-soft"
    >
      <Trash2 className="size-4" /> {label}
    </button>
  );
}
