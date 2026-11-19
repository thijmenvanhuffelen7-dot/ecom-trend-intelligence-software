"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { completeOnboarding } from "@/server/actions/onboarding";
import { useT } from "@/lib/i18n/client";
import { NICHE_EMOJI } from "@/lib/niches";
import { cn, flagEmoji } from "@/lib/utils";

const PERSONAS = ["dropshipper", "brand", "agency", "investor", "other"] as const;
const COUNTRIES = ["NL", "BE", "DE", "FR", "GB", "US", "CA", "AU", "SE", "IT", "ES"];

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("h-10 rounded-xl border px-3.5 text-sm font-medium transition", on ? "border-accent bg-accent-soft text-accent-strong" : "border-border hover:bg-surface-hover")}
    >
      {children}
    </button>
  );
}

export function OnboardingForm({ niches }: { niches: { slug: string; name: string }[] }) {
  const t = useT();
  const [persona, setPersona] = useState<(typeof PERSONAS)[number]>("dropshipper");
  const [picked, setPicked] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>(["NL", "BE"]);
  const [pending, start] = useTransition();
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const regionName = new Intl.DisplayNames([t.locale], { type: "region" });

  return (
    <div className="mt-6 space-y-7">
      <section>
        <p className="mb-3 text-sm font-semibold">{t("onboarding.role")}</p>
        <div className="flex flex-wrap gap-2">
          {PERSONAS.map((p) => (
            <Pill key={p} on={persona === p} onClick={() => setPersona(p)}>
              {t(`onboarding.personas.${p}`)}
            </Pill>
          ))}
        </div>
      </section>
      <section>
        <p className="mb-3 text-sm font-semibold">{t("onboarding.niches")}</p>
        <div className="flex flex-wrap gap-2">
          {niches.map((n) => (
            <Pill key={n.slug} on={picked.includes(n.slug)} onClick={() => setPicked(toggle(picked, n.slug))}>
              {NICHE_EMOJI[n.slug]} {n.name}
            </Pill>
          ))}
        </div>
      </section>
      <section>
        <p className="mb-3 text-sm font-semibold">{t("onboarding.countries")}</p>
        <div className="flex flex-wrap gap-2">
          {COUNTRIES.map((c) => (
            <Pill key={c} on={countries.includes(c)} onClick={() => setCountries(toggle(countries, c))}>
              {flagEmoji(c)} {regionName.of(c)}
            </Pill>
          ))}
        </div>
      </section>
      <button
        disabled={pending}
        onClick={() => start(() => completeOnboarding({ persona, niches: picked, countries }))}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent font-semibold text-accent-fg transition hover:brightness-95 disabled:opacity-70"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {t("onboarding.finish")} <ArrowRight className="size-4" />
      </button>
    </div>
  );
}
