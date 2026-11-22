import { PublicFooter, PublicHeader } from "./public-shell";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";

export type LegalSection = { h: string; p: string[] };

/** Gedeelde opmaak voor privacy en voorwaarden (inhoud per taal, als data). */
export async function LegalPage({ title, updated, sections }: { title: "privacyTitle" | "termsTitle"; updated: string; sections: { nl: LegalSection[]; en: LegalSection[] } }) {
  const t = await getT();
  const session = await getSession();
  const body = t.locale === "en" ? sections.en : sections.nl;
  return (
    <div className="min-h-dvh bg-bg">
      <PublicHeader t={t} loggedIn={!!session} />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6" data-testid="legal-page">
        <h1 className="text-4xl font-semibold tracking-tight">{t(`legal.${title}`)}</h1>
        <p className="mt-2 text-sm text-fg-muted">{t("legal.updated", { date: updated })}</p>
        <p className="mt-4 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm">{t("legal.draft")}</p>
        {body.map((s) => (
          <section key={s.h} className="mt-8">
            <h2 className="text-xl font-semibold">{s.h}</h2>
            {s.p.map((para, i) => <p key={i} className="mt-2 leading-relaxed text-fg-muted">{para}</p>)}
          </section>
        ))}
      </main>
      <PublicFooter t={t} />
    </div>
  );
}
