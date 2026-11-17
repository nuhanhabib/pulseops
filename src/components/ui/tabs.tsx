"use client";

import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "@/lib/cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("flex gap-5 overflow-x-auto border-b border-border", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn("relative -mb-px flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent text-sm font-medium text-muted transition-colors hover:text-text data-[state=active]:border-brand data-[state=active]:text-text", className)}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("pt-5 outline-none", className)} {...props} />;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
}

/** A compact single-choice control, used for time ranges and view switches. */
export function SegmentedControl<T extends string>({ value, onChange, options, label, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex h-8 items-center rounded-md border border-border-strong bg-surface p-0.5 shadow-sm", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn("h-full rounded-[5px] px-2.5 text-xs font-medium transition-colors", option.value === value ? "bg-surface-3 text-text" : "text-muted hover:text-text")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
