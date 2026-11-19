"use client";

import * as T from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export function Tabs({ tabs, defaultValue, className, listClassName }: { tabs: { value: string; label: React.ReactNode; content: React.ReactNode }[]; defaultValue?: string; className?: string; listClassName?: string }) {
  return (
    <T.Root defaultValue={defaultValue ?? tabs[0]?.value} className={className}>
      <T.List className={cn("inline-flex rounded-xl bg-bg-subtle p-1", listClassName)}>
        {tabs.map((tab) => (
          <T.Trigger
            key={tab.value}
            value={tab.value}
            className="h-8 rounded-lg px-3.5 text-[13px] font-medium text-fg-muted transition data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-sm"
          >
            {tab.label}
          </T.Trigger>
        ))}
      </T.List>
      {tabs.map((tab) => (
        <T.Content key={tab.value} value={tab.value} className="mt-4 outline-none">
          {tab.content}
        </T.Content>
      ))}
    </T.Root>
  );
}
