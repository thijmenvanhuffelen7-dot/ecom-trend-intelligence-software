"use client";

import { useActionState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { devLogin, type LoginState } from "@/server/actions/auth";
import { useT } from "@/lib/i18n/client";

export function LoginForm({ next }: { next?: string }) {
  const t = useT();
  const [state, action, pending] = useActionState<LoginState, FormData>(devLogin, {});
  return (
    <form action={action} className="mt-7 space-y-3">
      <label className="block text-xs font-medium text-[#9a9ea3]" htmlFor="email">
        {t("auth.email")}
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoFocus
        defaultValue="demo@trendscope.dev"
        className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-[15px] text-white placeholder:text-white/30 focus:border-accent/60 focus:ring-4 focus:ring-accent/15 focus:outline-none"
      />
      {next && <input type="hidden" name="next" value={next} />}
      {state.error && <p className="text-sm text-danger">{t("auth.invalidEmail")}</p>}
      <button
        disabled={pending}
        className="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-[#0b0c0d] transition hover:brightness-105 disabled:opacity-70"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {t("auth.submit")}
        {!pending && <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />}
      </button>
    </form>
  );
}
