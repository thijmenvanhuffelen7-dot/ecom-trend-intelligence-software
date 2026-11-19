"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Image, Mail, Megaphone, Package, PlayCircle, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

const TABS = [
  { href: "/explorer/shops", key: "shops", icon: Store },
  { href: "/explorer/products", key: "products", icon: Package },
  { href: "/explorer/ads", key: "ads", icon: PlayCircle },
  { href: "/explorer/advertisers", key: "advertisers", icon: Megaphone },
  { href: "/explorer/emails", key: "emails", icon: Mail },
  { href: "/explorer/images", key: "images", icon: Image },
] as const;

export function ExplorerTabs() {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              "flex h-10 items-center gap-2 rounded-xl px-3.5 text-[15px] font-medium whitespace-nowrap transition-colors",
              active ? "bg-bg-subtle font-semibold text-fg shadow-[inset_0_0_0_1px_var(--border)]" : "text-fg-muted hover:bg-bg-subtle hover:text-fg",
            )}
          >
            <tab.icon className={cn("size-[17px]", active && "text-accent")} />
            {t(`explorer.${tab.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
