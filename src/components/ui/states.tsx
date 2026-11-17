import { AlertTriangle, type LucideIcon, RotateCw } from "lucide-react";

import { cn } from "@/lib/cn";

import { Button } from "./button";

/** Shown when a view has nothing in it yet. Always says what to do next. */
export function EmptyState({ icon: Icon, title, description, action, className }: { icon: LucideIcon; title: string; description: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted"><Icon className="size-5" /></div>
      <h3 className="mt-4 text-base font-semibold text-text">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>
      {action && <div className="mt-5 flex items-center gap-2">{action}</div>}
    </div>
  );
}

/** Shown when loading failed. Always offers a way to recover. */
export function ErrorState({ title = "Could not load this", description, onRetry, className }: { title?: string; description?: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className="flex size-11 items-center justify-center rounded-xl bg-danger-soft text-danger-fg"><AlertTriangle className="size-5" /></div>
      <h3 className="mt-4 text-base font-semibold text-text">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{description ?? "Something went wrong while fetching this data."}</p>
      {onRetry && <Button className="mt-5" onClick={onRetry}><RotateCw />Try again</Button>}
    </div>
  );
}

/** Inline notice: neutral information, a warning, or sample-data labelling. */
export function Callout({ tone = "info", icon: Icon, title, children, className, action }: { tone?: "info" | "warn" | "danger" | "brand"; icon?: LucideIcon; title?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  const tones = { info: "border-info/25 bg-info-soft", warn: "border-warn/30 bg-warn-soft", danger: "border-danger/30 bg-danger-soft", brand: "border-brand/25 bg-brand-soft" };
  const text = { info: "text-info-fg", warn: "text-warn-fg", danger: "text-danger-fg", brand: "text-brand-text" };
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm", tones[tone], className)}>
      {Icon && <Icon className={cn("mt-0.5 size-4 shrink-0", text[tone])} />}
      <div className="min-w-0 flex-1 text-text-2">
        {title && <p className="font-medium text-text">{title}</p>}
        {children}
      </div>
      {action}
    </div>
  );
}
