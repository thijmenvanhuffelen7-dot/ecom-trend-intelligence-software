import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { CreateBoard } from "@/components/boards/create-board";
import { Card } from "@/components/ui/card";
import { EmptyState, Thumb } from "@/components/ui/misc";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/utils";
import { listBoards } from "@/server/queries/boards";

export const metadata = { title: "Boards" };

export default async function BoardsPage() {
  const session = await requireSession();
  const t = await getT();
  const boards = await listBoards(session.workspace.id);
  return (
    <div className="animate-rise">
      <header className="border-b border-border bg-bg px-8 pt-9 pb-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-[28px] font-semibold tracking-tight">
              <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-strong">
                <LayoutGrid className="size-5" />
              </span>
              {t("boards.title")}
            </h1>
            <p className="mt-2 text-fg-muted">{t("boards.subtitle")}</p>
          </div>
          <CreateBoard />
        </div>
      </header>
      <div className="p-6">
        {boards.length === 0 ? (
          <Card>
            <EmptyState icon={<LayoutGrid />} title={t("boards.empty")} hint={t("boards.emptyHint")} />
          </Card>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {boards.map((b) => (
              <Link key={b.id} href={`/boards/${b.id}`} className="group overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-0.5 bg-bg-subtle">
                  {[0, 1, 2, 3].map((i) =>
                    b.covers[i] ? (
                      <Thumb key={i} src={b.covers[i]} alt="" className="size-full border-0" rounded="rounded-none" />
                    ) : (
                      <div key={i} className="size-full" style={{ background: i === 0 ? `color-mix(in oklab, ${b.color ?? "var(--accent)"} 18%, transparent)` : undefined }} />
                    ),
                  )}
                </div>
                <div className="p-4">
                  <p className="flex items-center gap-2 font-semibold">
                    <span className="size-2.5 rounded-[3px]" style={{ background: b.color ?? "var(--accent)" }} />
                    {b.name}
                  </p>
                  <p className="mt-1 text-sm text-fg-muted">
                    {t("boards.items", { count: b.items })} · {formatDateTime(b.updated_at, t.locale)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
