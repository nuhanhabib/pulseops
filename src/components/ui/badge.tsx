import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";

const badgeVariants = cva("inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-2xs font-medium whitespace-nowrap [&_svg]:size-3", {
  variants: {
    tone: {
      neutral: "bg-neutral-soft text-text-2",
      brand: "bg-brand-soft text-brand-text",
      ok: "bg-ok-soft text-ok-fg",
      warn: "bg-warn-soft text-warn-fg",
      danger: "bg-danger-soft text-danger-fg",
      info: "bg-info-soft text-info-fg",
      outline: "border border-border-strong text-text-2",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
