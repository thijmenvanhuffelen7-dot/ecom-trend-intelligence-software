"use client";

import { Bookmark, BookmarkCheck, Check, Loader2, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { boardsForItem, createBoard, toggleBoardItem } from "@/server/actions/boards";

type BoardOption = { id: string; name: string; color: string | null; saved: boolean };

export function SaveToBoard({ entityType = "ad", entityId, compact = false }: { entityType?: "ad" | "product_cluster" | "store"; entityId: number; compact?: boolean }) {
  const t = useT();
  const [boards, setBoards] = useState<BoardOption[] | null>(null);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const saved = boards?.some((b) => b.saved) ?? false;

  const load = () => start(async () => setBoards(await boardsForItem({ entityType, entityId })));
  const toggle = (id: string) =>
    start(async () => {
      const res = await toggleBoardItem({ boardId: id, entityType, entityId });
      setBoards((bs) => bs?.map((b) => (b.id === id ? { ...b, saved: res.saved } : b)) ?? null);
    });
  const create = () =>
    start(async () => {
      if (!name.trim()) return;
      const board = await createBoard({ name });
      await toggleBoardItem({ boardId: board.id, entityType, entityId });
      setName("");
      setBoards(await boardsForItem({ entityType, entityId }));
    });

  return (
    <Popover onOpenChange={(open) => open && load()}>
      <PopoverTrigger asChild>
        <button
          aria-label={t("boards.saveTo")}
          className={cn(
            "relative z-10 inline-flex items-center gap-1.5 rounded-lg border font-medium transition",
            compact ? "size-8 justify-center" : "h-8 px-2.5 text-xs",
            saved ? "border-accent/40 bg-accent-soft text-accent-strong" : "border-border bg-surface text-fg hover:bg-surface-hover",
          )}
        >
          {saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
          {!compact && (saved ? t("boards.saved") : t("boards.save"))}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="px-2 pt-1 pb-2 text-xs font-semibold tracking-wide text-fg-subtle uppercase">{t("boards.saveTo")}</p>
        {boards === null ? (
          <div className="grid place-items-center py-6">
            <Loader2 className="size-4 animate-spin text-fg-subtle" />
          </div>
        ) : (
          <div className="scroll-area max-h-56 overflow-y-auto">
            {boards.map((b) => (
              <button key={b.id} onClick={() => toggle(b.id)} disabled={pending} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-hover">
                <span className="size-3 shrink-0 rounded-[4px]" style={{ background: b.color ?? "var(--accent)" }} />
                <span className="flex-1 truncate">{b.name}</span>
                {b.saved && <Check className="size-4 text-accent" />}
              </button>
            ))}
          </div>
        )}
        <form
          className="mt-1 flex gap-1.5 border-t border-border pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("boards.namePlaceholder")} className="h-8 min-w-0 flex-1 rounded-lg bg-bg-subtle px-2.5 text-sm focus:outline-none" />
          <button disabled={!name.trim() || pending} className="grid size-8 place-items-center rounded-lg bg-fg text-bg disabled:opacity-40" aria-label={t("boards.create")}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-4" />}
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
