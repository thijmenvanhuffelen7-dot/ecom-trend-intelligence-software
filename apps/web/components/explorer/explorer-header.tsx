import { Download } from "lucide-react";
import { ExplorerTabs } from "./explorer-tabs";
import { SearchBar } from "./search-bar";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";

/** Bovenbalk van elke Explorer-pagina: teller, tabs, export en zoekbalk. */
export function ExplorerHeader({
  count,
  countLabel,
  searchPlaceholder,
  exportHref,
  exportLabel,
  demo,
}: {
  count: string;
  countLabel: string;
  searchPlaceholder?: string;
  exportHref?: string;
  exportLabel?: string;
  demo?: { label: string; hint: string };
}) {
  return (
    <header className="border-b border-border bg-bg">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 pt-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 items-center gap-2 rounded-2xl border border-border bg-surface px-4 shadow-sm">
            <span className="tabular text-[17px] font-bold tracking-tight">{count}</span>
            <span className="text-[15px] font-medium text-fg-muted">{countLabel}</span>
          </div>
          {demo && (
            <Tooltip content={demo.hint}>
              <Badge tone="warning" className="cursor-help">
                {demo.label}
              </Badge>
            </Tooltip>
          )}
        </div>
        <div className="flex flex-1 justify-center">
          <ExplorerTabs />
        </div>
        {exportHref ? (
          <a
            href={exportHref}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-[15px] font-medium shadow-sm transition hover:bg-surface-hover"
          >
            <Download className="size-4" /> {exportLabel}
          </a>
        ) : (
          <span className="w-[120px]" />
        )}
      </div>
      <div className="px-6 pt-4 pb-4">{searchPlaceholder && <SearchBar placeholder={searchPlaceholder} />}</div>
    </header>
  );
}
