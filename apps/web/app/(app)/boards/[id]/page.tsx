import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { AdCard } from "@/components/ads/ad-card";
import { BoardItemMeta } from "@/components/boards/board-item";
import { DeleteBoardButton } from "@/components/boards/delete-board";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { getBoard } from "@/server/queries/boards";

export const metadata = { title: "Board" };

export default async function BoardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tag?: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const { tag } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await getT();
  const data = await getBoard(id, session.workspace.id);
  if (!data) notFound();
  const items = data.items.filter((i) => !tag || i.tags.includes(tag));
  return (
    <div className="animate-rise">
      <header className="border-b border-border bg-bg px-8 pt-6 pb-6">
        <Link href="/boards" className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg">
          <ArrowLeft className="size-4" /> {t("boards.title")}
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <h1 className="flex items-center gap-3 text-[26px] font-semibold tracking-tight">
            <span className="size-4 rounded-md" style={{ background: data.board.color ?? "var(--accent)" }} />
            {data.board.name}
            <span className="text-base font-normal text-fg-muted">{t("boards.items", { count: data.items.length })}</span>
          </h1>
          <DeleteBoardButton boardId={data.board.id} label={t("boards.delete")} />
        </div>
        {data.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {[undefined, ...data.tags].map((x) => (
              <Link
                key={x ?? "all"}
                href={x ? `/boards/${id}?tag=${encodeURIComponent(x)}` : `/boards/${id}`}
                className={cn("h-8 rounded-full border px-3 text-[13px] leading-[30px] font-medium", tag === x ? "border-fg bg-fg text-bg" : "border-border bg-surface hover:bg-surface-hover")}
              >
                {x ? `#${x}` : t("boards.allTags")}
              </Link>
            ))}
          </div>
        )}
      </header>
      <div className="p-6">
        {items.length === 0 ? (
          <Card>
            <EmptyState icon={<LayoutGrid />} title={t("boards.boardEmpty")} hint={t("boards.emptyHint")} />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {items.map((i) =>
              i.ad ? (
                <div key={`${i.entity_type}-${i.entity_id}`} className="flex flex-col">
                  <AdCard t={t} ad={{ ...i.ad, cta: null, countries: [], est_spend: null, store_id: null }} />
                  <div className="-mt-3 rounded-b-2xl border border-t-0 border-border bg-surface pt-3">
                    <BoardItemMeta boardId={id} entityType={i.entity_type} entityId={Number(i.entity_id)} note={i.note} tags={i.tags} />
                    {i.added_by && <p className="px-3 pb-2.5 text-[11px] text-fg-subtle">{t("boards.addedBy", { who: i.added_by })}</p>}
                  </div>
                </div>
              ) : null,
            )}
          </div>
        )}
      </div>
    </div>
  );
}
