import Link from "next/link";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { PricingTable } from "@/components/billing/pricing-table";
import { LogoMark } from "@/components/shell/logo";

export const metadata = { title: "Prijzen" };

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ interval?: string }> }) {
  const t = await getT();
  const session = await getSession();
  const interval = (await searchParams).interval === "year" ? "year" : "month";
  return (
    <div className="min-h-dvh bg-bg-subtle/60">
      <header className="flex items-center justify-between px-8 py-5">
        <Link href="/" className="flex items-center gap-2 font-semibold"><LogoMark /> Trendscope</Link>
        <Link href={session ? "/home" : "/login"} className="text-sm font-medium text-fg-muted hover:text-fg">{session ? "Dashboard →" : "Login →"}</Link>
      </header>
      <main className="mx-auto max-w-6xl px-6 pt-8 pb-20">
        <h1 className="text-center text-4xl font-semibold tracking-tight">{t("billing.pricingTitle")}</h1>
        <p className="mx-auto mt-3 max-w-2xl text-center text-fg-muted">{t("billing.pricingSubtitle")}</p>
        <div className="mt-10">
          <PricingTable t={t} interval={interval} currentPlan={session?.workspace.plan} loggedIn={!!session} canBuy={session?.role === "owner"} />
        </div>
      </main>
    </div>
  );
}
