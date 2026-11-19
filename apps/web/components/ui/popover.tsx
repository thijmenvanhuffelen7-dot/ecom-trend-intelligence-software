"use client";

import * as P from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverClose = P.Close;

export function PopoverContent({ className, align = "start", sideOffset = 8, ...props }: P.PopoverContentProps) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-2xl border border-border bg-surface p-3 text-fg shadow-pop outline-none",
          "data-[state=open]:animate-rise",
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}
