"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Clapperboard, Compass, Sparkles, Home, LayoutGrid, LineChart, LogOut, Moon, Radar, Search, Settings, Shield, Sun, Languages } from "lucide-react";
import { CommandPalette } from "./command-palette";
import { useTransition } from "react";
import { LogoMark } from "./logo";
import { Tooltip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { setLocale, setTheme } from "@/server/actions/preferences";
import { logout } from "@/server/actions/auth";

interface NavItem {
  href: string;
  key: "home" | "explorer" | "brandtracker" | "trends" | "social" | "assistant" | "boards";
  icon: React.ComponentType<{ className?: string }>;
  match: string;
  soon?: boolean;
}

const ITEMS: NavItem[] = [
  { href: "/home", key: "home", icon: Home, match: "/home" },
  { href: "/explorer/shops", key: "explorer", icon: Compass, match: "/explorer" },
  { href: "/brandtracker", key: "brandtracker", icon: Radar, match: "/brandtracker" },
  { href: "/trends", key: "trends", icon: LineChart, match: "/trends" },
  { href: "/social", key: "social", icon: Clapperboard, match: "/social" },
  { href: "/assistant", key: "assistant", icon: Sparkles, match: "/assistant" },
  { href: "/boards", key: "boards", icon: LayoutGrid, match: "/boards" },
];

function RailLink({ href, active, label, icon: Icon, soon, soonLabel }: { href: string; active: boolean; label: string; icon: NavItem["icon"]; soon?: boolean; soonLabel: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex w-full flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 text-[11.5px] font-medium transition-colors",
        active ? "text-frame-fg-active" : "text-frame-fg hover:bg-frame-hover hover:text-frame-fg-active",
        soon && "opacity-55",
      )}
    >
      <span
        className={cn(
          "grid size-9 place-items-center rounded-xl transition-colors",
          active ? "bg-accent text-[#0b0c0d] shadow-[0_0_0_4px_rgb(31_185_90/0.15)]" : "group-hover:bg-white/5",
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      {label}
      {soon && <span className="absolute top-1 right-1 rounded-full bg-accent/15 px-1.5 text-[9px] font-semibold text-accent">{soonLabel}</span>}
    </Link>
  );
}

export function Sidebar({ email, theme, isAdmin, unread = 0 }: { email: string; theme: "light" | "dark"; isAdmin: boolean; unread?: number }) {
  const pathname = usePathname();
  const t = useT();
  const [, start] = useTransition();

  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    start(() => setTheme(next));
  };

  return (
    <aside className="sticky top-0 flex h-dvh w-[92px] shrink-0 flex-col items-center px-2.5 py-4">
      <Link href="/home" aria-label="Trendscope" className="mb-6 transition-transform hover:scale-105">
        <LogoMark />
      </Link>
      <nav className="flex w-full flex-1 flex-col items-center gap-1">
        {ITEMS.map((item) => (
          <RailLink
            key={item.key}
            href={item.href}
            active={pathname.startsWith(item.match)}
            label={t(`nav.${item.key}`)}
            icon={item.icon}
            soon={item.soon}
            soonLabel={t("nav.soon")}
          />
        ))}
      </nav>
      <div className="flex w-full flex-col items-center gap-1">
        <CommandPalette>
          {(open) => (
            <Tooltip content={`${t("search.open")} · ⌘K`} side="right">
              <button onClick={open} aria-label={t("search.open")} className="grid size-10 place-items-center rounded-xl text-frame-fg hover:bg-frame-hover hover:text-white">
                <Search className="size-[18px]" />
              </button>
            </Tooltip>
          )}
        </CommandPalette>
        {isAdmin && (
          <Tooltip content={t("nav.admin")} side="right">
            <Link href="/admin" className={cn("grid size-10 place-items-center rounded-xl text-frame-fg hover:bg-frame-hover hover:text-white", pathname.startsWith("/admin") && "bg-frame-hover text-white")}>
              <Shield className="size-[18px]" />
            </Link>
          </Tooltip>
        )}
        <Tooltip content={t("nav.alerts")} side="right">
          <Link href="/alerts" aria-label={t("nav.alerts")} data-testid="nav-alerts" className={cn("relative grid size-10 place-items-center rounded-xl text-frame-fg hover:bg-frame-hover hover:text-white", pathname.startsWith("/alerts") && "bg-frame-hover text-white")}>
            <Bell className="size-[18px]" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] leading-4 font-bold text-accent-fg">{unread > 99 ? "99+" : unread}</span>
            )}
          </Link>
        </Tooltip>
        <Tooltip content={t("nav.theme")} side="right">
          <button onClick={toggleTheme} className="grid size-10 place-items-center rounded-xl text-frame-fg hover:bg-frame-hover hover:text-white" aria-label={t("nav.theme")}>
            {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
          </button>
        </Tooltip>
        <Popover>
          <PopoverTrigger asChild>
            <button className="mt-2 grid size-10 place-items-center rounded-full bg-gradient-to-br from-accent to-[#0f7a3a] text-sm font-bold text-[#0b0c0d] uppercase ring-2 ring-white/10 transition hover:ring-white/30">
              {email.slice(0, 1)}
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="end" className="w-64 p-1.5">
            <div className="px-2.5 py-2">
              <p className="truncate text-sm font-semibold">{email}</p>
            </div>
            <div className="my-1 h-px bg-border" />
            <Link href="/settings" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-hover">
              <Settings className="size-4 text-fg-muted" /> {t("nav.settings")}
            </Link>
            <button
              onClick={() => start(() => setLocale(t.locale === "nl" ? "en" : "nl"))}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-hover"
            >
              <Languages className="size-4 text-fg-muted" /> {t.locale === "nl" ? "English" : "Nederlands"}
            </button>
            <form action={logout}>
              <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-danger hover:bg-danger-soft">
                <LogOut className="size-4" /> {t("nav.logout")}
              </button>
            </form>
          </PopoverContent>
        </Popover>
      </div>
    </aside>
  );
}
