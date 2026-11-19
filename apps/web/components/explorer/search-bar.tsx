"use client";

import { Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useUpdateParams } from "./use-params";
import { Kbd } from "@/components/ui/misc";

export function SearchBar({ placeholder }: { placeholder: string }) {
  const { update, pending, searchParams } = useUpdateParams();
  const initial = searchParams.get("q") ?? "";
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => setValue(initial), [initial]);

  // debounce: pas na 300 ms stilte de URL bijwerken
  useEffect(() => {
    if (value === initial) return;
    const id = setTimeout(() => update({ q: value.trim() || null }), 300);
    return () => clearTimeout(id);
  }, [value, initial, update]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="group relative mx-auto w-full max-w-3xl">
      <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-fg-subtle" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-12 w-full rounded-2xl border border-transparent bg-bg-subtle pr-20 pl-11 text-[15px] text-fg placeholder:text-fg-subtle transition focus:border-border focus:bg-surface focus:shadow-md focus:outline-none"
      />
      <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-2">
        {pending && <Loader2 className="size-4 animate-spin text-fg-subtle" />}
        {value ? (
          <button onClick={() => setValue("")} className="grid size-6 place-items-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg" aria-label="Clear">
            <X className="size-4" />
          </button>
        ) : (
          <Kbd>/</Kbd>
        )}
      </div>
    </div>
  );
}
