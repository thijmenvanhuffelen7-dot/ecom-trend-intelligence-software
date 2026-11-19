"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALES, type Locale } from "@/lib/i18n/dictionaries";
import { LOCALE_COOKIE } from "@/lib/i18n/server";

const YEAR = 60 * 60 * 24 * 365;

export async function setLocale(locale: Locale) {
  if (!LOCALES.includes(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { maxAge: YEAR, sameSite: "lax", path: "/" });
  revalidatePath("/", "layout");
}

export async function setTheme(theme: "light" | "dark") {
  (await cookies()).set("ts_theme", theme === "dark" ? "dark" : "light", { maxAge: YEAR, sameSite: "lax", path: "/" });
}
