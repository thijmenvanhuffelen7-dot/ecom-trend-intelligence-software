import Link from "next/link";
import { LineChart } from "lucide-react";
import { PHASES, type Phase } from "@trendscope/core";
import { getDb } from "@trendscope/db";
import { Card } from "@/components/ui/card";
import { Thumb } from "@/components/ui/misc";
import { Meter, PHASE_COLORS, PhaseBadge } from "@/components/ui/score";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { NICHE_EMOJI } from "@/lib/niches";

export const metadata = { title: "Trends" };

export default async function TrendsPage() {
  await requireSession();
  const t = await getT();
  const rows = await getDb()
    .selectFrom("product_clusters as c")
    .innerJoin("scores as s", (j) => j.onRef("s.entity_id", "=", "c.id").on("s.entity_type", "=", "product_cluster"))
    .innerJoin("niches as n", "n.id", "c.niche_id")
    .select(["n.slug", "n.name_nl", "n.name_en", "c.id", "c.canonical_title", "c.image_url", "s.opportunity", "s.phase"])
    .orderBy("s.opportunity", "desc")
    .execute();
  const niches = [...new Map(rows.map((r) => [r.slug, r])).values()].map((n) => {
    const items = rows.filter((r) => r.slug === n.slug);
    return {
      ...n,
      avg: items.reduce((a, r) => a + r.opportunity, 0) / items.length,
      top: items[0]!,
      mix: PHASES.map((p) => ({ phase: p, n: items.filter((i) => i.phase === p).length })),
      total: items.length,
    };
  }).sort((a, b) => b.avg - a.avg);

  return (
    <div className="animate-rise">
      <header className="border-b border-border bg-bg px-8 pt-9 pb-7">
        <h1 className="flex items-center gap-3 text-[28px] font-semibold tracking-tight">
          <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-strong">
            <LineChart className="size-5" />
          </span>
          {t("trends.title")}
        </h1>
        <p className="mt-2 text-fg-muted">{t("trends.subtitle")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {PHASES.map((p) => (
            <PhaseBadge key={p} phase={p} label={t(`phases.${p}`)} />
          ))}
        </div>
      </header>
      <div className="bg-bg-subtle/60 p-6">
        <Card className="overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-border bg-bg-subtle/50 text-left text-sm text-fg-muted">
              <tr>
                <th className="px-5 py-3.5 font-medium">{t("trends.niche")}</th>
                <th className="px-5 py-3.5 font-medium">{t("home.phaseMix")}</th>
                <th className="w-48 px-5 py-3.5 font-medium">{t("trends.avgOpportunity")}</th>
                <th className="px-5 py-3.5 font-medium">{t("trends.topProduct")}</th>
              </tr>
            </thead>
            <tbody>
              {niches.map((n) => (
                <tr key={n.slug} className="border-b border-border last:border-0">
                  <td className="px-5 py-4 font-semibold">
                    <Link href={`/explorer/products?niche=${n.slug}`} className="hover:underline">
                      <span className="mr-2">{NICHE_EMOJI[n.slug]}</span>
                      {t.locale === "nl" ? n.name_nl : n.name_en}
                    </Link>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex h-2.5 w-56 overflow-hidden rounded-full bg-bg-subtle">
                      {n.mix.map((m) => (
                        <div key={m.phase} title={`${t(`phases.${m.phase}`)}: ${m.n}`} style={{ width: `${(m.n / n.total) * 100}%`, background: PHASE_COLORS[m.phase as Phase] }} />
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <Meter value={n.avg} />
                      <span className="tabular w-8 text-right font-semibold">{Math.round(n.avg)}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <Link href={`/explorer/products/${n.top.id}`} className="flex items-center gap-2.5 hover:underline">
                      <Thumb src={n.top.image_url} alt="" className="size-9" rounded="rounded-lg" />
                      <span className="text-sm font-medium">{n.top.canonical_title}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="mt-4 text-center text-sm text-fg-muted">{t("trends.comingSoon")}</p>
      </div>
    </div>
  );
}

