import { NextResponse } from "next/server";
import { CORS_HEADERS } from "@/server/api/auth";
import { openApiDocument } from "@/server/api/openapi";

/** Publiek: de OpenAPI 3.1-specificatie (ook bereikbaar als /api/v1/openapi.json via een rewrite). */
export function GET() {
  return NextResponse.json(openApiDocument(process.env.APP_URL ?? "http://localhost:3000"), { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" } });
}
