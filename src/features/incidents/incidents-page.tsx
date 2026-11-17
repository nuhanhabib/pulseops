"use client";

import { Plus, Search, SearchX, Siren } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Duration, RelativeTime } from "@/components/ui/relative-time";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { IncidentStatusBadge, SampleBadge, SEVERITY, SeverityBadge } from "@/components/ui/status";
import { Pagination, Table, TableContainer, Td, Th, Tr } from "@/components/ui/table";
import { SegmentedControl } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { useOrg } from "@/features/org/org-context";
import { useOrgQuery } from "@/features/shared";
import { cn } from "@/lib/cn";
import type { IncidentSeverity } from "@/shared/enums";
import type { IncidentListItemDto, Paginated } from "@/shared/types";

import { IncidentDialog } from "./incident-dialog";

const ALL = "__all";
type State = "all" | "open" | "resolved";

export function IncidentsPage() {
  const org = useOrg();
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState<State>("all");
  const [severity, setSeverity] = useState(ALL);
  const [assignee, setAssignee] = useState(ALL);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(params.get("new") === "1");

  useEffect(() => {
    const timer = setTimeout(() => { setQ(search.trim()); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const incidents = useOrgQuery<Paginated<IncidentListItemDto>>(["incidents", "list"], "/incidents", {
    state, severity: severity === ALL ? undefined : severity, assigneeId: assignee === ALL ? undefined : assignee, q, page, pageSize: 20,
  });
  const filtered = Boolean(q) || state !== "all" || severity !== ALL || assignee !== ALL;
  const clear = () => { setSearch(""); setState("all"); setSeverity(ALL); setAssignee(ALL); setPage(1); };
  const canWrite = org.can("incident:write");

  return (
    <PageContainer>
      <PageHeader title="Incidents" description="Outages and degradations, opened automatically by monitors or declared by your team."
        actions={canWrite && <Button variant="primary" onClick={() => setDialog(true)}><Plus />Declare incident</Button>} />

      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <SegmentedControl label="Incident state" value={state} onChange={(value) => { setState(value); setPage(1); }} options={[{ value: "all", label: "All" }, { value: "open", label: "Open" }, { value: "resolved", label: "Resolved" }]} />
        <div className="relative lg:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title or INC number" className="pl-8" aria-label="Search incidents" />
        </div>
        <div className="flex gap-2">
          <Select value={severity} onValueChange={(value) => { setSeverity(value); setPage(1); }}>
            <SelectTrigger className="w-40" aria-label="Filter by severity"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>All severities</SelectItem>{(Object.keys(SEVERITY) as IncidentSeverity[]).map((key) => <SelectItem key={key} value={key}>{SEVERITY[key].label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={assignee} onValueChange={(value) => { setAssignee(value); setPage(1); }}>
            <SelectTrigger className="w-40" aria-label="Filter by owner"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>Any owner</SelectItem><SelectItem value="me">Assigned to me</SelectItem><SelectItem value="unassigned">Unassigned</SelectItem></SelectContent>
          </Select>
        </div>
        {filtered && <Button variant="ghost" onClick={clear}>Clear filters</Button>}
      </div>

      <Card className="overflow-hidden" aria-busy={incidents.isFetching}>
        {incidents.isPending ? (
          <div className="flex flex-col gap-3 p-5">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-10" />)}</div>
        ) : incidents.isError ? (
          <ErrorState onRetry={() => incidents.refetch()} />
        ) : incidents.data.items.length === 0 ? (
          filtered ? <EmptyState icon={SearchX} title="No incidents match" description="Try a different search or clear the filters." action={<Button onClick={clear}>Clear filters</Button>} />
            : <EmptyState icon={Siren} title="No incidents yet" description="When a monitor stays down past its failure threshold, an incident opens here automatically." action={canWrite ? <Button variant="primary" onClick={() => setDialog(true)}><Plus />Declare incident</Button> : undefined} />
        ) : (
          <>
            <TableContainer className={cn("transition-opacity", incidents.isPlaceholderData && "opacity-60")}>
              <Table>
                <thead><tr><Th>Incident</Th><Th>Status</Th><Th className="hidden sm:table-cell">Severity</Th><Th className="hidden lg:table-cell">Affected</Th><Th className="hidden md:table-cell">Started</Th><Th className="hidden text-right md:table-cell">Duration</Th><Th className="hidden xl:table-cell">Owner</Th></tr></thead>
                <tbody>
                  {incidents.data.items.map((incident) => (
                    <Tr key={incident.id} interactive className="cursor-pointer" onClick={() => router.push(org.paths.incident(incident.id))}>
                      <Td className="max-w-0 w-[38%]">
                        <Link href={org.paths.incident(incident.id)} onClick={(event) => event.stopPropagation()} className="flex items-center gap-2 font-medium text-text hover:underline">
                          <span className="shrink-0 font-mono text-xs font-normal text-muted">INC-{incident.number}</span><span className="truncate">{incident.title}</span>
                        </Link>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">{incident.source === "AUTOMATED" ? "Opened automatically" : "Declared manually"}{incident.isPublic && <Badge tone="brand">Public</Badge>}{incident.isSample && <SampleBadge />}</span>
                      </Td>
                      <Td><IncidentStatusBadge status={incident.status} /></Td>
                      <Td className="hidden sm:table-cell"><SeverityBadge severity={incident.severity} /></Td>
                      <Td className="hidden max-w-48 truncate text-text-2 lg:table-cell">{incident.monitors.length ? incident.monitors.map((monitor) => monitor.name).join(", ") : "—"}</Td>
                      <Td className="hidden whitespace-nowrap text-text-2 md:table-cell"><RelativeTime date={incident.startedAt} /></Td>
                      <Td className="hidden text-right whitespace-nowrap tabular md:table-cell"><Duration from={incident.startedAt} to={incident.resolvedAt} /></Td>
                      <Td className="hidden xl:table-cell">{incident.assignee ? <Tooltip content={incident.assignee.name}><span className="inline-flex"><Avatar name={incident.assignee.name} /></span></Tooltip> : <span className="text-muted">—</span>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableContainer>
            <Pagination page={incidents.data.page} totalPages={incidents.data.totalPages} total={incidents.data.total} pageSize={incidents.data.pageSize} onPageChange={setPage} noun="incidents" />
          </>
        )}
      </Card>
      {canWrite && <IncidentDialog open={dialog} onOpenChange={setDialog} />}
    </PageContainer>
  );
}
