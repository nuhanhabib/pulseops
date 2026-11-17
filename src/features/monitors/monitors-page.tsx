"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowDown, ArrowUp, MoreHorizontal, Pause, Pencil, Play, Plus, Search, SearchX, Trash2, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Sparkline } from "@/components/charts/figures";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { RelativeTime } from "@/components/ui/relative-time";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { MONITOR_STATUS, MonitorStatusBadge, SampleBadge } from "@/components/ui/status";
import { Pagination, Table, TableContainer, Td, Th, Tr } from "@/components/ui/table";
import { orgKey, useOrg } from "@/features/org/org-context";
import { useOrgQuery } from "@/features/shared";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { MonitorStatus } from "@/shared/enums";
import { displayUrl, formatInterval, formatMs } from "@/shared/format";
import type { MONITOR_SORT_FIELDS } from "@/shared/schemas/monitor";
import type { MonitorDto, MonitorListItemDto, Paginated } from "@/shared/types";
import { formatUptime } from "@/shared/uptime";

type SortField = (typeof MONITOR_SORT_FIELDS)[number];
const ALL = "__all";

/** Pause/resume, run-now, and delete, shared by the list and the detail page. */
export function useMonitorActions() {
  const org = useOrg();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orgKey(org.organization.slug) });
  const toggle = useMutation({
    mutationFn: (monitor: MonitorDto) => api.patch<MonitorDto>(`${org.api}/monitors/${monitor.id}`, { enabled: !monitor.enabled }),
    onSuccess: (monitor) => { toast.success(monitor.enabled ? `${monitor.name} resumed` : `${monitor.name} paused`); void refresh(); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const checkNow = useMutation({
    mutationFn: (monitor: MonitorDto) => api.post<MonitorDto>(`${org.api}/monitors/${monitor.id}/check`),
    onSuccess: (monitor) => toast.success(`Check queued for ${monitor.name}`, { description: "The result will appear within a few seconds." }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (monitor: MonitorDto) => api.delete(`${org.api}/monitors/${monitor.id}`),
    onSuccess: (_result, monitor) => { toast.success(`${monitor.name} deleted`); void refresh(); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return { toggle, checkNow, remove };
}

function SortHeader({ field, sort, direction, onSort, children, className }: { field: SortField; sort: SortField; direction: "asc" | "desc"; onSort: (field: SortField) => void; children: React.ReactNode; className?: string }) {
  return (
    <Th className={className} aria-sort={sort === field ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <button onClick={() => onSort(field)} className="inline-flex items-center gap-1 transition-colors hover:text-text">
        {children}{sort === field && (direction === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </Th>
  );
}

export function MonitorsPage() {
  const org = useOrg();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [category, setCategory] = useState<string>(ALL);
  const [sort, setSort] = useState<SortField>("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<MonitorDto | null>(null);
  const actions = useMonitorActions();

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => { setQ(search.trim()); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const monitors = useOrgQuery<Paginated<MonitorListItemDto>>(["monitors", "list"], "/monitors", {
    q, status: status === ALL ? undefined : status, category: category === ALL ? undefined : category, sort, direction, page, pageSize: 25,
  });
  const categories = useOrgQuery<string[]>(["monitors", "categories"], "/monitors/categories");
  const filtered = Boolean(q) || status !== ALL || category !== ALL;
  const canWrite = org.can("monitor:write");

  const sortBy = (field: SortField) => {
    if (sort === field) setDirection(direction === "asc" ? "desc" : "asc");
    else { setSort(field); setDirection(field === "name" ? "asc" : "desc"); }
    setPage(1);
  };
  const sorting = { sort, direction, onSort: sortBy };

  return (
    <PageContainer>
      <PageHeader title="Monitors" description="Every website and API endpoint PulseOps is checking for this organization."
        actions={canWrite && <Button asChild variant="primary"><Link href={org.paths.newMonitor}><Plus />New monitor</Link></Button>} />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or URL" className="pl-8" aria-label="Search monitors" />
        </div>
        <div className="flex gap-2">
          <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
            <SelectTrigger className="w-40" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {(Object.keys(MONITOR_STATUS) as MonitorStatus[]).map((key) => <SelectItem key={key} value={key}>{MONITOR_STATUS[key].label}</SelectItem>)}
            </SelectContent>
          </Select>
          {(categories.data?.length ?? 0) > 0 && (
            <Select value={category} onValueChange={(value) => { setCategory(value); setPage(1); }}>
              <SelectTrigger className="w-44" aria-label="Filter by category"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {categories.data!.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        {filtered && <Button variant="ghost" onClick={() => { setSearch(""); setStatus(ALL); setCategory(ALL); }}>Clear filters</Button>}
      </div>

      <Card className="overflow-hidden" aria-busy={monitors.isFetching}>
        {monitors.isPending ? (
          <div className="flex flex-col gap-3 p-5">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-9" />)}</div>
        ) : monitors.isError ? (
          <ErrorState onRetry={() => monitors.refetch()} />
        ) : monitors.data.items.length === 0 ? (
          filtered ? (
            <EmptyState icon={SearchX} title="No monitors match" description="Try a different search term or clear the filters." action={<Button onClick={() => { setSearch(""); setStatus(ALL); setCategory(ALL); }}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={Activity} title="No monitors yet" description="Add a website or API endpoint and PulseOps will start checking it within seconds."
              action={canWrite ? <Button asChild variant="primary"><Link href={org.paths.newMonitor}><Plus />New monitor</Link></Button> : undefined} />
          )
        ) : (
          <>
            <TableContainer className={cn("transition-opacity", monitors.isPlaceholderData && "opacity-60")}>
              <Table>
                <thead>
                  <tr>
                    <SortHeader {...sorting} field="name">Monitor</SortHeader>
                    <SortHeader {...sorting} field="status">Status</SortHeader>
                    <Th className="hidden text-right md:table-cell">Uptime 24h</Th>
                    <SortHeader {...sorting} field="lastResponseTimeMs" className="hidden text-right sm:table-cell">Response</SortHeader>
                    <Th className="hidden lg:table-cell">Trend 24h</Th>
                    <Th className="hidden xl:table-cell">Interval</Th>
                    <SortHeader {...sorting} field="lastCheckedAt" className="hidden lg:table-cell">Last check</SortHeader>
                    <Th><span className="sr-only">Actions</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {monitors.data.items.map((monitor) => (
                    <Tr key={monitor.id} interactive className="cursor-pointer" onClick={() => router.push(org.paths.monitor(monitor.id))}>
                      <Td className="max-w-0 w-[34%]">
                        <Link href={org.paths.monitor(monitor.id)} onClick={(event) => event.stopPropagation()} className="flex items-center gap-2 font-medium text-text hover:underline">
                          <span className="truncate">{monitor.name}</span>
                          {monitor.isSample && <SampleBadge />}
                        </Link>
                        <span className="block truncate font-mono text-xs text-muted">{monitor.method} {displayUrl(monitor.url)}</span>
                      </Td>
                      <Td>
                        <MonitorStatusBadge status={monitor.status} />
                        {monitor.openIncidents > 0 && <span className="ml-2 text-xs text-danger-fg">{monitor.openIncidents} open</span>}
                      </Td>
                      <Td className="hidden text-right tabular md:table-cell">{formatUptime(monitor.uptime24h)}</Td>
                      <Td className="hidden text-right tabular sm:table-cell">{formatMs(monitor.lastResponseTimeMs)}</Td>
                      <Td className="hidden lg:table-cell"><Sparkline values={monitor.sparkline} label={`Response time trend for ${monitor.name}`} /></Td>
                      <Td className="hidden text-text-2 xl:table-cell">{formatInterval(monitor.intervalSeconds)}</Td>
                      <Td className="hidden text-text-2 lg:table-cell"><RelativeTime date={monitor.lastCheckedAt} /></Td>
                      <Td className="w-10 text-right" onClick={(event) => event.stopPropagation()}>
                        {canWrite && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${monitor.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem disabled={!monitor.enabled} onSelect={() => actions.checkNow.mutate(monitor)}><Zap />Run check now</DropdownMenuItem>
                              <DropdownMenuItem asChild><Link href={org.paths.editMonitor(monitor.id)}><Pencil />Edit</Link></DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => actions.toggle.mutate(monitor)}>{monitor.enabled ? <><Pause />Pause</> : <><Play />Resume</>}</DropdownMenuItem>
                              {org.can("monitor:delete") && <><DropdownMenuSeparator /><DropdownMenuItem destructive onSelect={() => setDeleting(monitor)}><Trash2 />Delete</DropdownMenuItem></>}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableContainer>
            <Pagination page={monitors.data.page} totalPages={monitors.data.totalPages} total={monitors.data.total} pageSize={monitors.data.pageSize} onPageChange={setPage} noun="monitors" />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)} destructive
        title={`Delete ${deleting?.name ?? "monitor"}?`} confirmLabel="Delete monitor" loading={actions.remove.isPending}
        description="Its check history and daily statistics are deleted with it, and it is removed from any status page. Incidents that referenced it are kept. This cannot be undone."
        onConfirm={() => deleting && actions.remove.mutate(deleting, { onSuccess: () => setDeleting(null) })}
      />
    </PageContainer>
  );
}
