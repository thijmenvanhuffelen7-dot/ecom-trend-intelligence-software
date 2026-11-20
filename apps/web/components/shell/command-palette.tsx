"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Package, Search, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { cn, flagEmoji } from "@/lib/utils";

type Result = {
  shops: { id: number; name: string | null; domain: string; country: string | null; screenshot_url: string | null }[];
  products: { id: number; title: string; image_url: string | null; phase: string | null; opportunity: number | null }[];
};

export function CommandPalette({ children }: { children: (open: () => void) => React.ReactNode }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [data, setData] = useState<Result>({ shops: [], products: [] });
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const req = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const id = ++req.current;
    if (!q.trim()) {
      setData({ shops: [], products: [] });
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (id === req.current && res.ok) {
        setData((await res.json()) as Result);
        setActive(0);
      }
      if (id === req.current) setLoading(false);
    }, 120);
    return () => clearTimeout(timer);
  }, [q]);

  const items = useMemo(
    () => [
      ...data.shops.map((s) => ({ key: `s${s.id}`, href: `/explorer/shops/${s.id}`, title: s.name ?? s.domain, sub: s.domain, img: s.screenshot_url, flag: s.country, kind: "shop" as const })),
      ...data.products.map((p) => ({ key: `p${p.id}`, href: `/explorer/products/${p.id}`, title: p.title, sub: p.opportunity != null ? `${Math.round(p.opportunity)}` : "", img: p.image_url, flag: null, kind: "product" as const })),
    ],
    [data],
  );

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {children(() => setOpen(true))}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed top-[14vh] left-1/2 z-50 w-[min(640px,92vw)] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-pop outline-none animate-rise"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(items.length - 1, a + 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
            if (e.key === "Enter" && items[active]) go(items[active].href);
          }}
        >
          <Dialog.Title className="sr-only">{t("search.open")}</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-border px-4">
            {loading ? <Loader2 className="size-5 animate-spin text-fg-subtle" /> : <Search className="size-5 text-fg-subtle" />}
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search.placeholder")} className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-fg-subtle" />
            <kbd className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">esc</kbd>
          </div>
          <div className="scroll-area max-h-[52vh] overflow-y-auto p-2">
            {!q && <p className="px-3 py-8 text-center text-sm text-fg-muted">{t("search.hint")}</p>}
            {q && !loading && items.length === 0 && <p className="px-3 py-8 text-center text-sm text-fg-muted">{t("search.empty")}</p>}
            {(["shop", "product"] as const).map((kind) => {
              const list = items.filter((i) => i.kind === kind);
              if (!list.length) return null;
              return (
                <div key={kind} className="mb-1">
                  <p className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
                    {kind === "shop" ? <Store className="size-3.5" /> : <Package className="size-3.5" />}
                    {kind === "shop" ? t("search.shops") : t("search.products")}
                  </p>
                  {list.map((item) => {
                    const idx = items.indexOf(item);
                    return (
                      <button
                        key={item.key}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => go(item.href)}
                        className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left", idx === active && "bg-surface-hover")}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {item.img ? <img src={item.img} alt="" className={cn("shrink-0 rounded-lg border border-border object-cover", kind === "shop" ? "h-8 w-12" : "size-9")} /> : <span className="h-8 w-12 rounded-lg bg-bg-subtle" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{item.title}</span>
                          <span className="block truncate text-xs text-fg-muted">{item.flag ? `${flagEmoji(item.flag)} ` : ""}{item.sub}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
