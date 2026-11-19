import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-9 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle shadow-sm transition focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-accent/25",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
