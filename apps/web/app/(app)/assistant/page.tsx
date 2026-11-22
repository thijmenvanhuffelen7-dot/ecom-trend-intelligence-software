import Link from "next/link";
import { DeleteConversation } from "@/components/assistant/delete-conversation";
import { MessageSquarePlus, Sparkles } from "lucide-react";
import { getDb } from "@trendscope/db";
import { Chat } from "@/components/assistant/chat";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { AI_MODEL, aiClient } from "@/server/ai/assistant";

export const metadata = { title: "Assistent" };
export const dynamic = "force-dynamic";

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const session = await requireSession();
  const t = await getT();
  const { c } = await searchParams;
  const db = getDb();
  const conversations = await db
    .selectFrom("ai_conversations")
    .select(["id", "title", "updated_at"])
    .where("workspace_id", "=", session.workspace.id)
    .orderBy("updated_at", "desc")
    .limit(30)
    .execute();
  const current = c && /^[0-9a-f-]{36}$/.test(c)
    ? await db.selectFrom("ai_conversations").select(["id", "messages"]).where("id", "=", c).where("workspace_id", "=", session.workspace.id).executeTakeFirst()
    : undefined;
  const live = !!aiClient();
  const suggestions = [t("assistant.s1"), t("assistant.s2"), t("assistant.s3"), t("assistant.s4")];

  return (
    <div className="grid h-[calc(100dvh-20px)] grid-cols-[260px_1fr] overflow-hidden">
      <aside className="flex flex-col border-r border-border bg-bg">
        <div className="flex items-center justify-between px-4 pt-5 pb-3">
          <h1 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-accent-strong" /> {t("assistant.title")}</h1>
          <Link href="/assistant" aria-label={t("assistant.new")} className="grid size-8 place-items-center rounded-lg hover:bg-surface-hover"><MessageSquarePlus className="size-4" /></Link>
        </div>
        <div className="px-4 pb-3">
          <Tooltip content={live ? t("assistant.liveHint") : t("assistant.offlineHint")}>
            <Badge tone={live ? "accent" : "warning"} className="cursor-help">{live ? `Live · ${AI_MODEL}` : t("assistant.offline")}</Badge>
          </Tooltip>
        </div>
        <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4" data-testid="conversation-list">
          {conversations.map((cv) => (
            <li key={cv.id} className="group flex items-center gap-1">
              <Link href={`/assistant?c=${cv.id}`} className={cn("block min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-sm hover:bg-surface-hover", cv.id === current?.id && "bg-surface-hover font-medium")}>{cv.title}</Link>
              <DeleteConversation id={cv.id} active={cv.id === current?.id} />
            </li>
          ))}
        </ul>
      </aside>
      <section className="min-w-0 bg-bg-subtle/60">
        <Chat key={current?.id ?? "new"} conversationId={current?.id} initial={(current?.messages as never) ?? []} suggestions={suggestions} />
      </section>
    </div>
  );
}
