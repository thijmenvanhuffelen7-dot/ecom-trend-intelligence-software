import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { dictionaries, LOCALES, type Locale } from "./dictionaries";
import { createTranslator } from "./translate";

export const LOCALE_COOKIE = "ts_locale";

export const getLocale = cache(async (): Promise<Locale> => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (fromCookie && (LOCALES as string[]).includes(fromCookie)) return fromCookie as Locale;
  const accept = (await headers()).get("accept-language") ?? "";
  return accept.toLowerCase().startsWith("en") ? "en" : "nl";
});

export const getT = cache(async () => {
  const locale = await getLocale();
  return createTranslator(dictionaries[locale], locale);
});
