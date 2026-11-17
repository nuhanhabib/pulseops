import { cn } from "@/lib/cn";

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-border-strong bg-surface-2 px-1 font-sans text-2xs font-medium text-muted", className)} {...props} />;
}
