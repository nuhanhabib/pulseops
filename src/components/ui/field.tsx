"use client";

import { Slot } from "radix-ui";
import { useId } from "react";

import { cn } from "@/lib/cn";

import { Label } from "./label";

interface FieldProps {
  label: string;
  /** Explains what the field is for. Announced to screen readers with the control. */
  hint?: React.ReactNode;
  error?: string;
  optional?: boolean;
  className?: string;
  children: React.ReactElement;
}

/**
 * Label, control, hint, and error wired together: the control gets an id,
 * `aria-invalid`, and `aria-describedby`, so validation feedback is read out
 * rather than merely shown.
 */
export function Field({ label, hint, error, optional, className, children }: FieldProps) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {optional && <span className="text-xs text-muted">Optional</span>}
      </div>
      <Slot.Root id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy}>
        {children}
      </Slot.Root>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger-fg">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormSection({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid gap-x-10 gap-y-4 border-t border-border py-6 first:border-t-0 first:pt-0 md:grid-cols-[240px_1fr]", className)}>
      <div>
        <h3 className="text-base font-semibold text-text">{title}</h3>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}
