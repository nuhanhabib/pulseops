"use client";

import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Activity, Globe, Moon, Plus, Search, Siren, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useState } from "react";

import { useTheme } from "@/components/providers/theme-provider";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { IncidentStatusBadge, StatusDot } from "@/components/ui/status";
import { orgKey, useOrg } from "@/features/org/org-context";
import { api } from "@/lib/api-client";
import { displayUrl } from "@/shared/format";
import type { SearchResultsDto } from "@/shared/types";

import { navItems } from "./nav";

const itemClass = "flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm text-text select-none data-[selected=true]:bg-surface-3 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted";
const groupClass = "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:uppercase";

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Global search and navigation. Opens with ⌘K / Ctrl+K, or "/" outside of inputs. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const org = useOrg();
  const router = useRouter();
  const { resolved, setTheme } = useTheme();
  const [term, setTerm] = useState("");
  const query = useDebounced(term.trim(), 180);

  const results = useQuery({
    queryKey: orgKey(org.organization.slug, "search", query),
    queryFn: ({ signal }) => api.get<SearchResultsDto>(`${org.api}/search`, { q: query }, signal),
    enabled: open,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });

  const go = (href: string) => {
    onOpenChange(false);
    setTerm("");
    router.push(href);
  };
  const nav = navItems(org.paths);
  const pages = [...nav.main, ...nav.secondary].filter((item) => !item.permission || org.can(item.permission));
  const data = results.data;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content aria-describedby={undefined} className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-overlay shadow-lg data-[state=open]:animate-pop-in">
          <DialogPrimitive.Title className="sr-only">Search and commands</DialogPrimitive.Title>
          {/* Filtering happens on the server for records; cmdk filters the static commands. */}
          <Command shouldFilter={false} loop>
            <div className="flex items-center gap-2.5 border-b border-border px-3.5">
              {results.isFetching ? <Spinner className="text-muted" /> : <Search className="size-4 text-muted" />}
              <Command.Input value={term} onValueChange={setTerm} placeholder="Search monitors, incidents, pages…" className="h-11 flex-1 bg-transparent text-base text-text outline-none placeholder:text-faint" />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[min(60vh,26rem)] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted">No results for “{term}”.</Command.Empty>
              {data && data.monitors.length > 0 && (
                <Command.Group heading="Monitors" className={groupClass}>
                  {data.monitors.map((monitor) => (
                    <Command.Item key={monitor.id} value={`monitor-${monitor.id}`} onSelect={() => go(org.paths.monitor(monitor.id))} className={itemClass}>
                      <StatusDot status={monitor.status} />
                      <span className="truncate">{monitor.name}</span>
                      <span className="ml-auto truncate font-mono text-xs text-muted">{displayUrl(monitor.url)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {data && data.incidents.length > 0 && (
                <Command.Group heading="Incidents" className={groupClass}>
                  {data.incidents.map((incident) => (
                    <Command.Item key={incident.id} value={`incident-${incident.id}`} onSelect={() => go(org.paths.incident(incident.id))} className={itemClass}>
                      <Siren />
                      <span className="font-mono text-xs text-muted">INC-{incident.number}</span>
                      <span className="truncate">{incident.title}</span>
                      <IncidentStatusBadge status={incident.status} className="ml-auto" />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {data && data.statusPages.length > 0 && (
                <Command.Group heading="Status pages" className={groupClass}>
                  {data.statusPages.map((page) => (
                    <Command.Item key={page.id} value={`page-${page.id}`} onSelect={() => go(org.paths.statusPageEditor(page.id))} className={itemClass}>
                      <Globe /><span className="truncate">{page.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!query && (
                <>
                  <Command.Group heading="Go to" className={groupClass}>
                    {pages.map((item) => (
                      <Command.Item key={item.href} value={`nav-${item.label}`} onSelect={() => go(item.href)} className={itemClass}>
                        <item.icon />{item.label}
                        {item.shortcut && <span className="ml-auto flex gap-1"><Kbd>G</Kbd><Kbd>{item.shortcut}</Kbd></span>}
                      </Command.Item>
                    ))}
                  </Command.Group>
                  <Command.Group heading="Actions" className={groupClass}>
                    {org.can("monitor:write") && <Command.Item value="new-monitor" onSelect={() => go(org.paths.newMonitor)} className={itemClass}><Plus />New monitor<Activity className="ml-auto" /></Command.Item>}
                    {org.can("incident:write") && <Command.Item value="new-incident" onSelect={() => go(`${org.paths.incidents}?new=1`)} className={itemClass}><Plus />Declare incident<Siren className="ml-auto" /></Command.Item>}
                    <Command.Item value="toggle-theme" onSelect={() => { setTheme(resolved === "dark" ? "light" : "dark"); onOpenChange(false); }} className={itemClass}>
                      {resolved === "dark" ? <Sun /> : <Moon />}Switch to {resolved === "dark" ? "light" : "dark"} theme
                    </Command.Item>
                  </Command.Group>
                </>
              )}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
