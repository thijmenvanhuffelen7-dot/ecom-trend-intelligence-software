import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/sidebar";
import { getDb, sql } from "@trendscope/db";
import { requireSession } from "@/lib/auth/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session.user.onboarded) redirect("/onboarding");
  const theme = (await cookies()).get("ts_theme")?.value === "dark" ? "dark" : "light";
  const { unread } = await getDb()
    .selectFrom("alert_events")
    .select(sql<number>`count(*)::int`.as("unread"))
    .where("workspace_id", "=", session.workspace.id)
    .where("read_at", "is", null)
    .executeTakeFirstOrThrow();
  return (
    <div className="flex min-h-dvh bg-frame">
      <Sidebar email={session.user.email} theme={theme} isAdmin={session.role !== "member" || session.user.isPlatformAdmin} unread={unread} />
      <main className="min-w-0 flex-1 py-2.5 pr-2.5">
        <div className="scroll-area min-h-[calc(100dvh-20px)] overflow-hidden rounded-[22px] bg-bg-subtle">{children}</div>
      </main>
    </div>
  );
}
