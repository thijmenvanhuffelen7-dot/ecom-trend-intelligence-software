import { cn } from "@/lib/utils";

/** Neutrale platform-markering (geen merklogo's): letter + kleur. */
const STYLE: Record<string, { label: string; cls: string }> = {
  meta: { label: "Meta", cls: "bg-[#e7efff] text-[#1d4ed8] dark:bg-[#172554] dark:text-[#93c5fd]" },
  tiktok: { label: "TikTok", cls: "bg-[#fde7f0] text-[#be185d] dark:bg-[#3b0d22] dark:text-[#f9a8d4]" },
  google: { label: "Google", cls: "bg-[#fef3c7] text-[#a16207] dark:bg-[#3a2a06] dark:text-[#fcd34d]" },
};

export function PlatformBadge({ platform, className }: { platform: string; className?: string }) {
  const s = STYLE[platform] ?? { label: platform, cls: "bg-bg-subtle text-fg-muted" };
  return <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-semibold", s.cls, className)}>{s.label}</span>;
}
