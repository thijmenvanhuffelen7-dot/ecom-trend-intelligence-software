"use client";

import { useTransition } from "react";
import { setLocale, setTheme } from "@/server/actions/preferences";
import { cn } from "@/lib/utils";

export function Segmented({ value, options, kind }: { value: string; options: { value: string; label: string }[]; kind: "locale" | "theme" }) {
  const [pending, start] = useTransition();
  return (
    <div className={cn("inline-flex rounded-xl bg-bg-subtle p-1", pending && "opacity-60")}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() =>
            start(async () => {
              if (kind === "theme") {
                document.documentElement.dataset.theme = o.value;
                await setTheme(o.value as "light" | "dark");
              } else await setLocale(o.value as "nl" | "en");
            })
          }
          className={cn("h-8 rounded-lg px-4 text-sm font-medium transition", value === o.value ? "bg-surface shadow-sm" : "text-fg-muted hover:text-fg")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
