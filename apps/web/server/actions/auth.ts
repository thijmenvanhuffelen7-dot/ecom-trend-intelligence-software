"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authMode, authSecret } from "@/lib/auth/server";
import { SESSION_COOKIE, sessionMaxAge, signSession } from "@/lib/auth/token";

const LoginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), next: z.string().optional() });

export interface LoginState {
  error?: "invalid_email";
}

export async function devLogin(_: LoginState, form: FormData): Promise<LoginState> {
  if (authMode() !== "dev") redirect("/sign-in");
  const parsed = LoginSchema.safeParse({ email: form.get("email"), next: form.get("next") ?? undefined });
  if (!parsed.success) return { error: "invalid_email" };
  (await cookies()).set(SESSION_COOKIE, await signSession(parsed.data.email, authSecret()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionMaxAge,
    path: "/",
  });
  // Alleen relatieve paden: voorkomt open redirects
  const next = parsed.data.next;
  redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/home");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect(authMode() === "clerk" ? "/sign-in" : "/login");
}
