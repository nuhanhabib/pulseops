"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Bot, ScrollText, Search } from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SampleBadge } from "@/components/ui/status";
import { Table, TableContainer, Td, Th, Tr } from "@/components/ui/table";
import { orgKey, useOrg } from "@/features/org/org-context";
import { api } from "@/lib/api-client";
import { formatFullDateTime } from "@/shared/format";
import type { AuditLogDto, CursorPage } from "@/shared/types";

const ALL = "__all";
const CATEGORIES = [["monitor", "Monitors"], ["incident", "Incidents"], ["member", "Members"], ["status_page", "Status pages"], ["notification", "Notifications"], ["organization", "Organization"], ["account", "Account"]] as const;

/** "monitor.created" → "Created monitor" */
function describe(action: string): string {
  const [subject = "", verb = ""] = action.split(".");
  const text = `${verb.replaceAll("_", " ")} ${subject.replaceAll("_", " ")}`.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function AuditLogPage() {
  const org = useOrg();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState(ALL);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => { const timer = setTimeout(() => setQ(search.trim()), 250); return () => clearTimeout(timer); }, [search]);

  const log = useInfiniteQuery({
    queryKey: orgKey(org.organization.slug, "audit", { q, category }),
    queryFn: ({ pageParam }) => api.get<CursorPage<AuditLogDto>>(`${org.api}/audit-log`, { limit: 40, cursor: pageParam, q, action: category === ALL ? undefined : category }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: org.can("audit:read"),
  });
  const rows = log.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <PageContainer>
      <PageHeader title="Audit log" description="A record of who changed what in this organization. Entries cannot be edited or deleted, and never contain secrets." />
      {!org.can("audit:read") ? <Card><EmptyState icon={ScrollText} title="Owners and admins only" description="Your role does not include access to the audit log. Ask an owner or admin if you need something from it." /></Card> : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative sm:w-80"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search actor, target, or action" className="pl-8" aria-label="Search audit log" /></div>
            <Select value={category} onValueChange={setCategory}><SelectTrigger className="w-44" aria-label="Filter by area"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All areas</SelectItem>{CATEGORIES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
          </div>
          <Card className="overflow-hidden">
            {log.isPending ? <div className="flex flex-col gap-3 p-5">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-8" />)}</div>
              : log.isError ? <ErrorState onRetry={() => log.refetch()} />
              : rows.length === 0 ? <EmptyState icon={ScrollText} title={q || category !== ALL ? "No matching entries" : "No activity recorded yet"} description={q || category !== ALL ? "Try a different search or area." : "Changes to monitors, incidents, members, and settings will be recorded here."} />
              : (
                <>
                  <TableContainer>
                    <Table>
                      <thead><tr><Th>Actor</Th><Th>Action</Th><Th>Target</Th><Th className="hidden lg:table-cell">IP address</Th><Th className="text-right">Time</Th></tr></thead>
                      <tbody>
                        {rows.map((entry) => (
                          <Fragment key={entry.id}>
                            <Tr interactive={Boolean(entry.metadata)} className={entry.metadata ? "cursor-pointer" : undefined} onClick={() => entry.metadata && setExpanded(expanded === entry.id ? null : entry.id)}>
                              <Td className="h-11"><span className="flex items-center gap-2">{entry.actorType === "SYSTEM" ? <span className="flex size-6 items-center justify-center rounded-full bg-surface-3 text-muted"><Bot className="size-3.5" /></span> : <Avatar name={entry.actorLabel} />}<span className="truncate">{entry.actorLabel}</span></span></Td>
                              <Td className="h-11"><span className="flex items-center gap-2">{describe(entry.action)}{entry.isSample && <SampleBadge />}</span><span className="block font-mono text-2xs text-muted">{entry.action}</span></Td>
                              <Td className="h-11 max-w-56 truncate text-text-2">{entry.targetLabel ?? "—"}</Td>
                              <Td className="hidden h-11 font-mono text-xs text-muted lg:table-cell">{entry.ipAddress ?? "—"}</Td>
                              <Td className="h-11 text-right text-xs whitespace-nowrap text-text-2"><time dateTime={entry.createdAt}>{formatFullDateTime(entry.createdAt)}</time></Td>
                            </Tr>
                            {expanded === entry.id && entry.metadata && <tr><td colSpan={5} className="border-b border-border bg-surface-2 px-5 py-3"><pre className="overflow-x-auto font-mono text-xs text-text-2">{JSON.stringify(entry.metadata, null, 2)}</pre></td></tr>}
                          </Fragment>
                        ))}
                      </tbody>
                    </Table>
                  </TableContainer>
                  {log.hasNextPage && <div className="border-t border-border p-3 text-center"><Button onClick={() => log.fetchNextPage()} loading={log.isFetchingNextPage}>Load older entries</Button></div>}
                </>
              )}
          </Card>
        </>
      )}
    </PageContainer>
  );
}
