"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, CheckCircle2, Info, LogOut, Menu, Monitor, Moon, Search, Sun, User, XCircle } from "lucide-react";
import Link from "next/link";

import { type ThemeChoice, useTheme } from "@/components/providers/theme-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { RelativeTime } from "@/components/ui/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { SampleBadge } from "@/components/ui/status";
import { Tooltip } from "@/components/ui/tooltip";
import { orgKey, useOrg } from "@/features/org/org-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { ActivityLevel } from "@/shared/enums";
import { routes } from "@/shared/routes";
import type { ActivityInboxDto } from "@/shared/types";

import { Breadcrumbs } from "./breadcrumbs";

const LEVEL_ICON: Record<ActivityLevel, { icon: typeof Info; className: string }> = {
  CRITICAL: { icon: XCircle, className: "text-danger-fg" },
  WARNING: { icon: AlertTriangle, className: "text-warn-fg" },
  SUCCESS: { icon: CheckCircle2, className: "text-ok-fg" },
  INFO: { icon: Info, className: "text-info-fg" },
};

function ActivityInbox() {
  const org = useOrg();
  const queryClient = useQueryClient();
  const key = orgKey(org.organization.slug, "activity", "inbox");
  const inbox = useQuery({ queryKey: key, queryFn: () => api.get<ActivityInboxDto>(`${org.api}/activity`, { limit: 15 }) });
  const markSeen = useMutation({
    mutationFn: () => api.post(`${org.api}/activity`),
    // Optimistic: clearing a badge is safe to show before the server confirms.
    onMutate: () => queryClient.setQueryData<ActivityInboxDto>(key, (current) => (current ? { ...current, unreadCount: 0 } : current)),
  });
  const unread = inbox.data?.unreadCount ?? 0;
  return (
    <Popover onOpenChange={(open) => { if (open && unread > 0) markSeen.mutate(); }}>
      <Tooltip content="Activity">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Activity, ${unread} new` : "Activity"}>
            <Bell />
            {unread > 0 && <span className="absolute top-1 right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent className="w-[min(calc(100vw-1.5rem),24rem)] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Activity</h2>
          <span className="text-xs text-muted">Monitor and incident events</span>
        </div>
        <div className="max-h-[26rem] overflow-y-auto">
          {inbox.isPending ? (
            <div className="flex flex-col gap-3 p-4">{[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-9" />)}</div>
          ) : inbox.isError ? (
            <p className="p-6 text-center text-sm text-muted">Could not load activity. <button className="text-brand-text underline" onClick={() => inbox.refetch()}>Retry</button></p>
          ) : inbox.data.items.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted">Nothing yet. Events appear here when monitors change state.</p>
          ) : (
            <ul>
              {inbox.data.items.map((item) => {
                const level = LEVEL_ICON[item.level];
                const href = item.incidentId ? org.paths.incident(item.incidentId) : item.monitorId ? org.paths.monitor(item.monitorId) : org.paths.dashboard;
                const isNew = !inbox.data.seenAt || item.occurredAt > inbox.data.seenAt;
                return (
                  <li key={item.id}>
                    <Link href={href} className="flex gap-3 border-b border-border px-4 py-2.5 transition-colors last:border-b-0 hover:bg-surface-2">
                      <level.icon className={cn("mt-0.5 size-4 shrink-0", level.className)} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm text-text"><span className="truncate">{item.title}</span>{item.isSample && <SampleBadge />}</span>
                        {item.description && <span className="block truncate text-xs text-muted">{item.description}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                        <RelativeTime date={item.occurredAt} />
                        {isNew && <span className="size-1.5 rounded-full bg-brand" aria-label="New" />}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "dark", label: "Dark", icon: Moon }, { value: "light", label: "Light", icon: Sun }, { value: "system", label: "System", icon: Monitor },
];

function UserMenu() {
  const org = useOrg();
  const { theme, setTheme } = useTheme();
  const signOut = useMutation({
    mutationFn: () => api.post("/api/v1/auth/logout"),
    // A full navigation, so no cached data from this session survives in memory.
    onSettled: () => window.location.assign(routes.signIn),
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full" aria-label="Account menu"><Avatar name={org.user.name} size="lg" className="size-7 text-2xs" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium text-text">{org.user.name}</p>
          <p className="truncate text-xs text-muted">{org.user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href={org.paths.settingsProfile}><User />Profile and security</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href={org.paths.settingsNotifications}><Bell />Notification preferences</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {THEMES.map((option) => (
          <DropdownMenuCheckboxItem key={option.value} checked={theme === option.value} onCheckedChange={() => setTheme(option.value)} onSelect={(event) => event.preventDefault()}>
            <option.icon />{option.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut.mutate()}><LogOut />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ onOpenSearch, onOpenNav }: { onOpenSearch: () => void; onOpenNav: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-13 shrink-0 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur-md sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenNav} aria-label="Open navigation"><Menu /></Button>
      <Breadcrumbs />
      <div className="ml-auto flex items-center gap-1.5">
        <button onClick={onOpenSearch} className="hidden h-8 w-56 items-center gap-2 rounded-md border border-border-strong bg-surface px-2.5 text-sm text-faint shadow-sm transition-colors hover:border-muted/60 md:flex" aria-label="Search">
          <Search className="size-3.5" /><span className="flex-1 text-left">Search…</span><Kbd>⌘K</Kbd>
        </button>
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onOpenSearch} aria-label="Search"><Search /></Button>
        <ActivityInbox />
        <UserMenu />
      </div>
    </header>
  );
}
