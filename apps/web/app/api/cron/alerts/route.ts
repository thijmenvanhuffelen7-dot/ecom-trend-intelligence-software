import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@trendscope/db";
import { evaluateWorkspace } from "@/server/alerts/evaluate";

export const dynamic = "force-dynamic";

/** Vercel Cron (elke 15 minuten): evalueert de regels van elke workspace met actieve regels. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(secret);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const workspaces = await getDb().selectFrom("alert_rules").select("workspace_id").distinct().where("enabled", "=", true).execute();
  let events = 0;
  for (const w of workspaces) events += (await evaluateWorkspace(w.workspace_id)).events;
  return NextResponse.json({ workspaces: workspaces.length, events });
}
