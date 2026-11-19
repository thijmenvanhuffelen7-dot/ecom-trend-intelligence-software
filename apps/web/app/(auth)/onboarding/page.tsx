import { redirect } from "next/navigation";
import { getDb } from "@trendscope/db";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { Logo } from "@/components/shell/logo";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const session = await requireSession();
  if (session.user.onboarded) redirect("/home");
  const t = await getT();
  const niches = await getDb().selectFrom("niches").select(["slug", "name_nl", "name_en"]).orderBy("name_en").execute();
  return (
    <div className="relative min-h-dvh bg-frame px-4 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_40%_at_50%_0%,rgb(31_185_90/0.18),transparent_70%)]" />
      <div className="relative mx-auto max-w-2xl animate-rise">
        <Logo light className="mb-8" />
        <div className="rounded-3xl bg-bg p-8 shadow-pop">
          <h1 className="text-2xl font-semibold tracking-tight">{t("onboarding.title")}</h1>
          <OnboardingForm niches={niches.map((n) => ({ slug: n.slug, name: t.locale === "nl" ? n.name_nl : n.name_en }))} />
        </div>
      </div>
    </div>
  );
}
