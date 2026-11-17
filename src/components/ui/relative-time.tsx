"use client";

import { useSyncExternalStore } from "react";

import { formatDuration, formatFullDateTime, formatRelative } from "@/shared/format";

import { Tooltip } from "./tooltip";

/** One shared 15-second clock for every relative timestamp on the page. */
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    now = Date.now();
    listeners.forEach((notify) => notify());
  }, 15_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** The current time, refreshed every 15 seconds. Null on the server and during hydration. */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, () => now, () => null);
}

/** "4m ago", with the exact timestamp on hover and in the `title` for assistive tech. */
export function RelativeTime({ date, className }: { date: string | null | undefined; className?: string }) {
  const current = useNow();
  if (!date) return <span className={className}>—</span>;
  return (
    <Tooltip content={formatFullDateTime(date)}>
      <time dateTime={date} className={className} suppressHydrationWarning>
        {current === null ? "" : formatRelative(date, new Date(current))}
      </time>
    </Tooltip>
  );
}

/** A live-updating duration between `from` and `to` (or now). */
export function Duration({ from, to, className }: { from: string; to?: string | null; className?: string }) {
  const current = useNow();
  const end = to ? new Date(to).getTime() : current;
  return <span className={className} suppressHydrationWarning>{end === null ? "" : formatDuration((end - new Date(from).getTime()) / 1000)}</span>;
}
