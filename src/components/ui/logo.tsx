import { cn } from "@/lib/cn";
import { APP_NAME } from "@/shared/constants";

/** The PulseOps mark: a heartbeat trace resolving into a steady line. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} role="img" aria-label={APP_NAME}>
      <defs>
        <linearGradient id="pulseops-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="oklch(0.62 0.2 278)" />
          <stop offset="1" stopColor="oklch(0.56 0.22 300)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#pulseops-mark)" />
      <path d="M5.5 17h5.2l2.6-7.2 4.6 13 3-8.3 1.5 2.5h4.1" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-display text-md font-semibold tracking-tight text-text", className)}>
      <LogoMark className={markClassName} />
      {APP_NAME}
    </span>
  );
}
