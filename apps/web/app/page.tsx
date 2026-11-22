import Image from "next/image";
import Link from "next/link";
import { BarChart3, Bot, Clapperboard, Megaphone, ShieldCheck, Store, TrendingUp, Workflow } from "lucide-react";
import { PublicFooter, PublicHeader } from "@/components/marketing/public-shell";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";

export const metadata = {
  title: { absolute: "Trendscope · winnende producten vinden met uitlegbare scores" },
  description: "Trend- en concurrentie-intelligentie voor e-commerce: producten, webshops, ads, TikTok Shop en zoektrends aan elkaar gekoppeld en gescoord.",
  openGraph: { title: "Trendscope", description: "Vind winnende producten voordat de markt vol zit.", images: ["/landing/products.png"] },
};

const FEATURES = [
  ["products", BarChart3],
  ["shops", Store],
  ["ads", Megaphone],
  ["trends", TrendingUp],
  ["social", Clapperboard],
  ["ai", Bot],
] as const;

export default async function Landing() {
  const t = await getT();
  const session = await getSession();
  const cta = session ? "/home" : "/login";
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <PublicHeader t={t} loggedIn={!!session} />
      <main>
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgb(31_185_90/0.16),transparent_70%)]" />
          <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-10 text-center sm:px-6 sm:pt-24">
            <p className="text-sm font-semibold text-accent-strong">{t("landing.eyebrow")}</p>
            <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">{t("landing.title")}</h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-fg-muted">{t("landing.subtitle")}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href={cta} className="rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg shadow-sm" data-testid="hero-cta">{session ? t("landing.nav.dashboard") : t("landing.ctaPrimary")}</Link>
              <Link href="/pricing" className="rounded-xl border border-border bg-surface px-5 py-3 font-semibold hover:bg-surface-hover">{t("landing.ctaSecondary")}</Link>
            </div>
            {!session && <p className="mt-3 text-xs text-fg-subtle">{t("landing.ctaNote")}</p>}
            <div className="mx-auto mt-12 max-w-5xl overflow-hidden rounded-2xl border border-border shadow-pop">
              <Image src="/landing/products.png" alt="Productexplorer met opportuniteit, validatie en saturatie per product" width={1600} height={1000} priority sizes="(max-width: 1100px) 100vw, 1024px" />
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight">{t("landing.featuresTitle")}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([key, Icon]) => (
              <div key={key} className="rounded-2xl border border-border bg-surface p-5">
                <Icon className="size-5 text-accent-strong" aria-hidden />
                <h3 className="mt-3 font-semibold">{t(`landing.features.${key}.title`)}</h3>
                <p className="mt-1.5 text-sm text-fg-muted">{t(`landing.features.${key}.body`)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-bg-subtle/60">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">{t("landing.howTitle")}</h2>
              <ol className="mt-6 space-y-4">
                {(["one", "two", "three"] as const).map((k, i) => (
                  <li key={k} className="flex gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-strong">{i + 1}</span>
                    <p className="text-fg-muted">{t(`landing.how.${k}`)}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div className="overflow-hidden rounded-2xl border border-border shadow-sm">
              <Image src="/landing/ads.png" alt="Ads-explorer met looptijd en varianten" width={1600} height={1000} sizes="(max-width: 1024px) 100vw, 560px" />
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:px-6 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-6">
            <ShieldCheck className="size-5 text-accent-strong" aria-hidden />
            <h2 className="mt-3 text-xl font-semibold">{t("landing.trustTitle")}</h2>
            <p className="mt-2 text-sm text-fg-muted">{t("landing.trustBody")}</p>
            <Link href="/privacy" className="mt-3 inline-block text-sm font-medium text-accent-strong hover:underline">{t("landing.trustLink")} →</Link>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-6">
            <Workflow className="size-5 text-accent-strong" aria-hidden />
            <h2 className="mt-3 text-xl font-semibold">{t("landing.integrationsTitle")}</h2>
            <p className="mt-2 text-sm text-fg-muted">{t("landing.integrationsBody")}</p>
            <Link href="/developers" className="mt-3 inline-block text-sm font-medium text-accent-strong hover:underline">{t("landing.nav.api")} →</Link>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">{t("landing.faqTitle")}</h2>
          <div className="mt-6 divide-y divide-border rounded-2xl border border-border bg-surface">
            {(["1", "2", "3", "4"] as const).map((n) => (
              <details key={n} className="group px-5 py-4">
                <summary className="cursor-pointer list-none font-medium marker:hidden">{t(`landing.faq.q${n}`)}</summary>
                <p className="mt-2 text-sm text-fg-muted">{t(`landing.faq.a${n}`)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="bg-frame text-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-14 sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight">{t("landing.finalTitle")}</h2>
            <Link href={cta} className="rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg">{session ? t("landing.nav.dashboard") : t("landing.ctaPrimary")}</Link>
          </div>
        </section>
      </main>
      <PublicFooter t={t} />
    </div>
  );
}
