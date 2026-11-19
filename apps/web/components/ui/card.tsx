import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-border bg-surface shadow-sm", className)} {...props} />;
}

export function CardHeader({
  title,
  icon,
  action,
  hint,
  className,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-fg [&_svg]:size-4 [&_svg]:text-fg-muted">
          {icon}
          {title}
        </h3>
        {hint && <p className="mt-0.5 text-[13px] text-fg-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}
