import { Info } from "lucide-react";
import type { Estimate } from "@trendscope/core";
import { formatEstimateRange } from "@trendscope/core";
import { Tooltip } from "./tooltip";
import type { Translator } from "@/lib/i18n/translate";

/** Toont een geschat cijfer altijd met label, bandbreedte, betrouwbaarheid en methode. */
export function EstimateValue({ estimate, t, range = true }: { estimate: Estimate | null; t: Translator; range?: boolean }) {
  if (!estimate) return <span className="text-fg-subtle">—</span>;
  const dots = { low: 1, medium: 2, high: 3 }[estimate.confidence];
  return (
    <Tooltip
      content={
        <div className="space-y-1">
          <div className="font-semibold">{t("shop.estimate")} · {t(`shop.confidence.${estimate.confidence}`)}</div>
          <div className="text-white/70">
            {t("shop.method")}: {estimate.method}
          </div>
        </div>
      }
    >
      <span className="inline-flex cursor-help items-center gap-1.5">
        <span className="tabular">{range ? formatEstimateRange(estimate, t.locale) : estimate.value}</span>
        <span className="inline-flex items-center gap-[2px]" aria-label={t(`shop.confidence.${estimate.confidence}`)}>
          {[1, 2, 3].map((i) => (
            <span key={i} className={`h-2.5 w-1 rounded-full ${i <= dots ? "bg-accent" : "bg-border-strong"}`} />
          ))}
        </span>
        <Info className="size-3.5 text-fg-subtle" />
      </span>
    </Tooltip>
  );
}
