import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const VARIANTS = {
  primary: "bg-fg text-bg hover:opacity-90 shadow-sm",
  accent: "bg-accent text-accent-fg hover:brightness-95 shadow-sm",
  outline: "border border-border bg-surface text-fg hover:bg-surface-hover shadow-sm",
  ghost: "text-fg-muted hover:text-fg hover:bg-surface-hover",
  soft: "bg-bg-subtle text-fg hover:bg-surface-hover",
} as const;

const SIZES = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-9 px-3.5 text-sm gap-2 rounded-xl",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-xl",
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
}

export const buttonClass = (variant: keyof typeof VARIANTS = "outline", size: keyof typeof SIZES = "md", className?: string) =>
  cn(
    "inline-flex items-center justify-center font-medium whitespace-nowrap transition-[background,opacity,box-shadow,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
    VARIANTS[variant],
    SIZES[size],
    className,
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={buttonClass(variant, size, className)} {...props} />
));
Button.displayName = "Button";
