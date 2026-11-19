import { redirect } from "next/navigation";
import { authMode } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { LoginForm } from "./login-form";
import { Logo } from "@/components/shell/logo";

export const metadata = { title: "Login" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (authMode() === "clerk") redirect("/sign-in");
  const t = await getT();
  const { next } = await searchParams;
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-frame px-4">
      {/* achtergrond: zacht groen licht + raster */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgb(31_185_90/0.22),transparent_70%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.03)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.03)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(70%_60%_at_50%_30%,#000,transparent)]" />
      <div className="relative w-full max-w-[420px] animate-rise">
        <div className="mb-8 flex justify-center">
          <Logo light />
        </div>
        <div className="rounded-3xl border border-white/10 bg-[#121315]/90 p-8 shadow-pop backdrop-blur">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{t("auth.title")}</h1>
          <p className="mt-1.5 text-sm text-[#9a9ea3]">{t("auth.subtitle")}</p>
          <LoginForm next={next} />
          <p className="mt-6 rounded-xl bg-white/[0.04] px-3.5 py-3 text-xs leading-relaxed text-[#85898e]">{t("auth.devNote")}</p>
        </div>
        <p className="mt-6 text-center text-xs text-[#6c7076]">{t("brand.tagline")}</p>
      </div>
    </div>
  );
}
