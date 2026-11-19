import { NextResponse } from "next/server";
import { getDb, sql } from "@trendscope/db";
import { ch } from "@/server/clickhouse";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = await Promise.allSettled([sql`select 1`.execute(getDb()), ch().ping()]);
  const [pg, clickhouse] = checks.map((c) => (c.status === "fulfilled" && (c.value as { success?: boolean }).success !== false ? "ok" : "down"));
  const ok = pg === "ok" && clickhouse === "ok";
  return NextResponse.json({ status: ok ? "ok" : "degraded", postgres: pg, clickhouse }, { status: ok ? 200 : 503 });
}
