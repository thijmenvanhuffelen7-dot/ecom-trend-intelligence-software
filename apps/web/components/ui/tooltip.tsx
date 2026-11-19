"use client";

import * as T from "@radix-ui/react-tooltip";

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <T.Provider delayDuration={150}>{children}</T.Provider>;
}

export function Tooltip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: T.TooltipContentProps["side"] }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-72 rounded-lg bg-[#111214] px-2.5 py-1.5 text-xs leading-relaxed text-white shadow-pop"
        >
          {content}
          <T.Arrow className="fill-[#111214]" />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
