import Link from "next/link";
import { LogoMark } from "@/components/shell/logo";
import type { Translator } from "@/lib/i18n/translate";

export function PublicHeader({ t, loggedIn }: { t: Translator; loggedIn: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold"><LogoMark /> Trendscope</Link>
        <nav className="hidden flex-1 items-center gap-5 text-sm text-fg-muted sm:flex" aria-label="Hoofdmenu">
          <Link href="/#features" className="hover:text-fg">{t("landing.nav.features")}</Link>
          <Link href="/pricing" className="hover:text-fg">{t("landing.nav.pricing")}</Link>
          <Link href="/developers" className="hover:text-fg">{t("landing.nav.api")}</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          {loggedIn ? (
            <Link href="/home" className="rounded-xl bg-fg px-3.5 py-2 text-sm font-semibold text-bg">{t("landing.nav.dashboard")}</Link>
          ) : (
            <>
              <Link href="/login" className="px-2 text-sm font-medium text-fg-muted hover:text-fg">{t("landing.nav.login")}</Link>
              <Link href="/login" className="rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-accent-fg">{t("landing.ctaPrimary")}</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function PublicFooter({ t }: { t: Translator }) {
  return (
    <footer className="border-t border-border bg-bg-subtle/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-8 text-sm text-fg-muted sm:px-6">
        <span className="flex items-center gap-2 font-semibold text-fg"><LogoMark /> Trendscope</span>
        <Link href="/pricing" className="hover:text-fg">{t("landing.footer.pricing")}</Link>
        <Link href="/developers" className="hover:text-fg">{t("landing.footer.api")}</Link>
        <Link href="/privacy" className="hover:text-fg">{t("landing.footer.privacy")}</Link>
        <Link href="/terms" className="hover:text-fg">{t("landing.footer.terms")}</Link>
        <span className="w-full text-xs text-fg-subtle sm:ml-auto sm:w-auto">© {new Date().getFullYear()} Trendscope · {t("landing.footer.rights")}</span>
      </div>
    </footer>
  );
}
