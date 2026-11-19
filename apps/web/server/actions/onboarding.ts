"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@trendscope/db";
import { requireSession } from "@/lib/auth/server";

const Schema = z.object({
  persona: z.enum(["dropshipper", "brand", "agency", "investor", "other"]),
  niches: z.array(z.string().max(40)).max(12),
  countries: z.array(z.string().length(2)).max(20),
});

export async function completeOnboarding(input: z.input<typeof Schema>) {
  const session = await requireSession();
  const data = Schema.parse(input);
  const db = getDb();
  const valid = await db.selectFrom("niches").select("slug").where("slug", "in", data.niches.length ? data.niches : ["-"]).execute();
  await db.transaction().execute(async (trx) => {
    await trx.updateTable("users").set({ persona: data.persona, onboarded_at: new Date() }).where("id", "=", session.user.id).execute();
    if (session.role !== "member") {
      await trx
        .updateTable("workspaces")
        .set({ niches: valid.map((v) => v.slug), countries: data.countries.map((c) => c.toUpperCase()) })
        .where("id", "=", session.workspace.id)
        .execute();
    }
  });
  redirect("/home");
}
