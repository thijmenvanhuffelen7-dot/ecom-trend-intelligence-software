import type { Dictionary, Locale } from "./dictionaries";

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type Paths<T> = T extends string ? never : { [K in keyof T]: T[K] extends string ? K : Join<K, Paths<T[K]>> }[keyof T];
export type TKey = Paths<Dictionary>;

export type Translator = ((key: TKey, vars?: Record<string, string | number>) => string) & { locale: Locale };

export function createTranslator(dict: Dictionary, locale: Locale): Translator {
  const t = ((key: TKey, vars?: Record<string, string | number>) => {
    const value = key.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], dict);
    if (typeof value !== "string") return key;
    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, (_, name: string) => {
      const v = vars[name];
      return v === undefined ? `{${name}}` : typeof v === "number" ? new Intl.NumberFormat(locale).format(v) : v;
    });
  }) as Translator;
  t.locale = locale;
  return t;
}
