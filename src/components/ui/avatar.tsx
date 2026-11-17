import { cn } from "@/lib/cn";
import { initials } from "@/shared/format";

/** Deterministic hue from the name, so a person keeps their colour everywhere. */
function hueFor(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const hue = hueFor(name);
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none", size === "sm" ? "size-5 text-[9px]" : size === "lg" ? "size-9 text-sm" : "size-6 text-2xs", className)}
      style={{ background: `linear-gradient(135deg, oklch(0.6 0.15 ${hue}), oklch(0.48 0.17 ${(hue + 40) % 360}))` }}
    >
      {initials(name)}
    </span>
  );
}
