import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@trendscope/db";
import { LimitExceededError } from "@trendscope/core";
import { getSession } from "@/lib/auth/server";
import { getLocale } from "@/lib/i18n/server";
import { chat, type ChatTurn, type StreamEvent } from "@/server/ai/assistant";
import { consumeAiCredit } from "@/server/ai/usage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({ conversationId: z.string().uuid().optional(), message: z.string().trim().min(1).max(2000) });

/** Streamt het antwoord als NDJSON: één JSON-object per regel (text, tool, tool_result, done, error). */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  try {
    await consumeAiCredit(session.workspace.id, session.workspace.plan);
  } catch (e) {
    if (e instanceof LimitExceededError) return NextResponse.json({ error: "limit" }, { status: 402 });
    throw e;
  }
  const db = getDb();
  const locale = (await getLocale()) === "en" ? "en" : "nl";
  let conv = parsed.data.conversationId
    ? await db.selectFrom("ai_conversations").select(["id", "messages"]).where("id", "=", parsed.data.conversationId).where("workspace_id", "=", session.workspace.id).executeTakeFirst()
    : undefined;
  if (!conv) {
    conv = await db
      .insertInto("ai_conversations")
      .values({ workspace_id: session.workspace.id, user_id: session.user.id, title: parsed.data.message.slice(0, 80), messages: "[]", model: "pending" })
      .returning(["id", "messages"])
      .executeTakeFirstOrThrow();
  }
  type Stored = ChatTurn & { tools?: { name: string; input: unknown }[] };
  const history = [...((conv.messages as Stored[]) ?? []), { role: "user" as const, text: parsed.data.message }];
  const convId = conv.id;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent | { type: "conversation"; id: string }) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      send({ type: "conversation", id: convId });
      let answer = "";
      let model = "offline";
      const tools: { name: string; input: unknown }[] = [];
      try {
        for await (const ev of chat(history.slice(-12).map(({ role, text }) => ({ role, text })), locale)) {
          if (ev.type === "text") answer += ev.text;
          if (ev.type === "tool") tools.push({ name: ev.name, input: ev.input });
          if (ev.type === "done") model = ev.model;
          send(ev);
        }
      } catch (err) {
        console.error("assistant error", err);
        send({ type: "error", message: locale === "nl" ? "De assistent is even niet bereikbaar." : "The assistant is unavailable right now." });
      } finally {
        const messages = [...history, { role: "assistant" as const, text: answer, tools }];
        await db.updateTable("ai_conversations").set({ messages: JSON.stringify(messages), model, updated_at: new Date() }).where("id", "=", convId).execute();
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
