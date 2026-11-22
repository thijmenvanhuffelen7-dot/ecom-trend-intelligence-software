import { z } from "zod";
import type { PlanId } from "./plans";

/** Uitrol van een feature flag: percentage van workspaces (stabiel per workspace), en/of expliciete plannen/workspaces. */
export const FlagRolloutSchema = z.object({
  percent: z.number().int().min(0).max(100).default(100),
  plans: z.array(z.enum(["free", "starter", "pro", "business"])).default([]),
  workspaces: z.array(z.string().uuid()).default([]),
});
export type FlagRollout = z.infer<typeof FlagRolloutSchema>;

export const FlagKeySchema = z.string().regex(/^[a-z][a-z0-9_.-]{1,48}$/);

/** FNV-1a 32-bit: deterministisch en zonder crypto, zodat browser/Node/Python hetzelfde bucket kiezen. */
export function flagBucket(key: string, workspaceId: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${key}:${workspaceId}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

export function flagEnabledFor(
  flag: { key: string; enabled: boolean; rollout: unknown } | undefined,
  ws: { id: string; plan: PlanId },
): boolean {
  if (!flag?.enabled) return false;
  const r = FlagRolloutSchema.safeParse(flag.rollout ?? {});
  if (!r.success) return false;
  const { percent, plans, workspaces } = r.data;
  if (workspaces.includes(ws.id)) return true;
  if (plans.length && !plans.includes(ws.plan)) return false;
  return flagBucket(flag.key, ws.id) < percent;
}
