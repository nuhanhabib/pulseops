import { cn } from "@/lib/cn";

export const fieldClasses =
  "w-full rounded-md border border-border-strong bg-surface text-sm text-text shadow-sm transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-muted/60 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-(--brand-ring) disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/30";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input type={type} className={cn(fieldClasses, "h-8 px-2.5", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClasses, "min-h-20 resize-y px-2.5 py-2 leading-5", className)} {...props} />;
}
