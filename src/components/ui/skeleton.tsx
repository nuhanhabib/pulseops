import { cn } from "@/lib/cn";

/** Placeholder block. Decorative: the surrounding region carries `aria-busy`. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("skeleton", className)} {...props} />;
}
