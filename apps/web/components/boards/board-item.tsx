"use client";

import { Loader2, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { toggleBoardItem, updateBoardItem } from "@/server/actions/boards";

/** Notitie + tags bij een opgeslagen item; slaat op bij verlaten van het veld. */
export function BoardItemMeta({ boardId, entityType, entityId, note, tags }: { boardId: string; entityType: string; entityId: number; note: string | null; tags: string[] }) {
  const t = useT();
  const [value, setValue] = useState(note ?? "");
  const [list, setList] = useState(tags);
  const [tag, setTag] = useState("");
  const [removed, setRemoved] = useState(false);
  const [pending, start] = useTransition();
  const save = (patch: { note?: string; tags?: string[] }) => start(() => updateBoardItem({ boardId, entityType, entityId, ...patch }));
  if (removed) return null;
  return (
    <div className="space-y-2 border-t border-border p-3">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value !== (note ?? "") && save({ note: value })}
        placeholder={t("boards.notePlaceholder")}
        rows={2}
        className="w-full resize-none rounded-lg bg-bg-subtle px-2.5 py-2 text-sm placeholder:text-fg-subtle focus:ring-2 focus:ring-accent/25 focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {list.map((x) => (
          <span key={x} className="inline-flex h-6 items-center gap-1 rounded-full bg-accent-soft px-2 text-xs font-medium text-accent-strong">
            #{x}
            <button
              aria-label={`${t("boards.remove")} ${x}`}
              onClick={() => {
                const next = list.filter((y) => y !== x);
                setList(next);
                save({ tags: next });
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value.replace(/[^\w-]/g, "").toLowerCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter" && tag) {
              e.preventDefault();
              const next = [...new Set([...list, tag])];
              setList(next);
              setTag("");
              save({ tags: next });
            }
          }}
          placeholder={t("boards.addTag")}
          className="h-6 w-28 bg-transparent text-xs placeholder:text-fg-subtle focus:outline-none"
        />
        <span className="ml-auto flex items-center gap-1">
          {pending && <Loader2 className="size-3.5 animate-spin text-fg-subtle" />}
          <button
            onClick={() => start(async () => { await toggleBoardItem({ boardId, entityType, entityId }); setRemoved(true); })}
            className="grid size-7 place-items-center rounded-lg text-fg-subtle hover:bg-danger-soft hover:text-danger"
            aria-label={t("boards.remove")}
          >
            <Trash2 className="size-3.5" />
          </button>
        </span>
      </div>
    </div>
  );
}
