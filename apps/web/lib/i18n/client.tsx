"use client";

import { createContext, useContext, useMemo } from "react";
import { dictionaries, type Locale } from "./dictionaries";
import { createTranslator, type Translator } from "./translate";

const I18nContext = createContext<Translator | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const t = useMemo(() => createTranslator(dictionaries[locale], locale), [locale]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

export function useT(): Translator {
  const t = useContext(I18nContext);
  if (!t) throw new Error("useT buiten I18nProvider");
  return t;
}
