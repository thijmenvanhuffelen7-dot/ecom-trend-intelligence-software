import Link from "next/link";
import { Lock } from "lucide-react";

/** Upsell-melding als een planlimiet is bereikt; de pagina blijft bruikbaar (alleen de begrensde actie valt weg). */
export function LimitBanner({ message, cta }: { message: string; cta: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm" role="status" data-testid="limit-banner">
      <Lock className="size-4 text-warning" />
      <span className="flex-1">{message}</span>
      <Link href="/settings/billing" className="font-semibold text-fg underline-offset-2 hover:underline">{cta} →</Link>
    </div>
  );
}
