import "server-only";
import { cache } from "react";
import { getDb } from "@trendscope/db";
import { flagEnabledFor } from "@trendscope/core";
import type { Session } from "@/lib/auth/server";

const loadFlags = cache(async () => getDb().selectFrom("feature_flags").select(["key", "enabled", "rollout"]).execute());

/** Feature flag voor de huidige workspace (één query per request; uitrol per percentage en/of plan). */
export async function featureEnabled(key: string, session: Pick<Session, "workspace">): Promise<boolean> {
  const flags = await loadFlags();
  return flagEnabledFor(flags.find((f) => f.key === key), { id: session.workspace.id, plan: session.workspace.plan });
}
