"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Globe, Lock, MessageSquare, Pencil, StickyNote, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useBreadcrumbTitle } from "@/components/layout/breadcrumbs";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Switch } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Duration, RelativeTime } from "@/components/ui/relative-time";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { INCIDENT_STATUS, IncidentStatusBadge, MonitorStatusBadge, SampleBadge, SEVERITY, SeverityBadge } from "@/components/ui/status";
import { SegmentedControl } from "@/components/ui/tabs";
import { orgKey, useOrg } from "@/features/org/org-context";
import { useOrgQuery } from "@/features/shared";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { INCIDENT_STATUS_ORDER } from "@/shared/constants";
import type { IncidentSeverity } from "@/shared/enums";
import { formatDateTime } from "@/shared/format";
import type { AuditLogDto, IncidentDetailDto, MemberDto, TimelineEntryDto } from "@/shared/types";

import { AiPanel } from "./ai-panel";
import { MonitorChecklist } from "./incident-dialog";

const UNASSIGNED = "__none";
const KEEP = "__keep";

function TimelineItem({ entry }: { entry: TimelineEntryDto }) {
  const isNote = entry.type === "note";
  const system = entry.type === "update" && entry.kind === "SYSTEM";
  const Icon = isNote ? StickyNote : system ? Bot : MessageSquare;
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      <span aria-hidden className="absolute top-7 bottom-0 left-[13px] w-px bg-border last:hidden" />
      <span className={cn("relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border", isNote ? "border-warn/40 bg-warn-soft text-warn-fg" : system ? "border-border bg-surface-2 text-muted" : "border-brand/30 bg-brand-soft text-brand-text")}><Icon className="size-3.5" /></span>
      <div className={cn("min-w-0 flex-1", isNote && "rounded-lg border border-warn/25 bg-warn-soft/50 px-3 py-2")}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="font-medium text-text">{entry.author?.name ?? "PulseOps"}</span>
          {isNote ? <Badge tone="warn"><Lock />Internal note</Badge> : entry.status ? <IncidentStatusBadge status={entry.status} /> : null}
          {entry.type === "update" && entry.isPublic && <Badge tone="brand"><Globe />Public</Badge>}
          <RelativeTime date={entry.createdAt} />
        </div>
        <p className={cn("mt-1 text-sm whitespace-pre-wrap", system ? "text-text-2" : "text-text")}>{isNote ? entry.body : entry.message}</p>
      </div>
    </li>
  );
}

function SideRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 py-2"><dt className="text-sm text-muted">{label}</dt><dd className="min-w-0 text-right text-sm">{children}</dd></div>;
}

export function IncidentDetailPage({ incidentId }: { incidentId: string }) {
  const org = useOrg();
  const router = useRouter();
  const queryClient = useQueryClient();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"update" | "note">("update");
  const [message, setMessage] = useState("");
  const [nextStatus, setNextStatus] = useState<string>(KEEP);
  const [publish, setPublish] = useState(false);
  const [view, setView] = useState<"timeline" | "activity">("timeline");
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [linked, setLinked] = useState<string[]>([]);

  const incidentQuery = useOrgQuery<IncidentDetailDto>(["incident", incidentId, "detail"], `/incidents/${incidentId}`);
  const members = useOrgQuery<MemberDto[]>(["members"], "/members");
  const activity = useOrgQuery<AuditLogDto[]>(["incident", incidentId, "activity"], `/incidents/${incidentId}/activity`, undefined, { enabled: view === "activity" });
  const incident = incidentQuery.data;
  useBreadcrumbTitle(incident ? `INC-${incident.number}` : null);
  const canWrite = org.can("incident:write");

  const settle = (data: IncidentDetailDto) => {
    queryClient.setQueryData(orgKey(org.organization.slug, "incident", incidentId, "detail", {}), data);
    void queryClient.invalidateQueries({ queryKey: orgKey(org.organization.slug, "incidents") });
    void queryClient.invalidateQueries({ queryKey: orgKey(org.organization.slug, "incident", incidentId) });
  };
  const onError = (error: unknown) => toast.error(errorMessage(error));

  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch<IncidentDetailDto>(`${org.api}/incidents/${incidentId}`, body), onSuccess: settle, onError });
  const post = useMutation({
    mutationFn: () => mode === "note"
      ? api.post<IncidentDetailDto>(`${org.api}/incidents/${incidentId}/notes`, { body: message })
      : api.post<IncidentDetailDto>(`${org.api}/incidents/${incidentId}/updates`, { message, status: nextStatus === KEEP ? undefined : nextStatus, isPublic: publish }),
    onSuccess: (data) => { settle(data); setMessage(""); setNextStatus(KEEP); setPublish(false); toast.success(mode === "note" ? "Note added" : nextStatus === "RESOLVED" ? "Incident resolved" : "Update posted"); },
    onError,
  });
  const setMonitors = useMutation({ mutationFn: () => api.put<IncidentDetailDto>(`${org.api}/incidents/${incidentId}/monitors`, { monitorIds: linked }), onSuccess: (data) => { settle(data); setLinking(false); }, onError });
  const remove = useMutation({ mutationFn: () => api.delete(`${org.api}/incidents/${incidentId}`), onSuccess: () => { toast.success("Incident deleted"); void queryClient.invalidateQueries({ queryKey: orgKey(org.organization.slug, "incidents") }); router.push(org.paths.incidents); }, onError });

  if (incidentQuery.isError) return <PageContainer><Card><ErrorState title="Incident not found" description="It may have been deleted, or you may not have access to it." onRetry={() => incidentQuery.refetch()} /></Card></PageContainer>;
  if (!incident) return <PageContainer><Skeleton className="h-8 w-80" /><div className="mt-6 grid gap-4 lg:grid-cols-[1fr_20rem]"><Skeleton className="h-96" /><Skeleton className="h-72" /></div></PageContainer>;

  const resolved = incident.status === "RESOLVED";

  return (
    <PageContainer>
      <PageHeader
        title={<><span className="font-mono text-base font-normal text-muted">INC-{incident.number}</span><span className="min-w-0 break-words">{incident.title}</span></>}
        meta={<><IncidentStatusBadge status={incident.status} /><SeverityBadge severity={incident.severity} /><span>{incident.source === "AUTOMATED" ? "Opened automatically" : `Declared by ${incident.createdBy?.name ?? "a former member"}`} <RelativeTime date={incident.startedAt} /></span><span>{resolved ? "Lasted " : "Open for "}<Duration from={incident.startedAt} to={incident.resolvedAt} /></span>{incident.isSample && <SampleBadge />}</>}
        actions={canWrite && <>
          <Button onClick={() => { setDraftTitle(incident.title); setDraftSummary(incident.summary ?? ""); setEditing(true); }}><Pencil />Edit</Button>
          {org.can("incident:delete") && <Button variant="danger-ghost" size="icon" aria-label="Delete incident" onClick={() => setConfirmDelete(true)}><Trash2 /></Button>}
        </>}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {incident.summary && <Card><CardContent className="pt-4 text-sm whitespace-pre-wrap text-text-2">{incident.summary}</CardContent></Card>}

          {canWrite && (
            <Card>
              <CardContent className="flex flex-col gap-3 pt-4">
                <SegmentedControl label="Entry type" value={mode} onChange={setMode} options={[{ value: "update", label: "Timeline update" }, { value: "note", label: "Internal note" }]} className="self-start" />
                <Textarea ref={composerRef} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} aria-label={mode === "note" ? "Internal note" : "Timeline update"}
                  placeholder={mode === "note" ? "Visible to your team only. Never shown on a status page." : "What changed, what you know, what happens next."} />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  {mode === "update" ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <Select value={nextStatus} onValueChange={setNextStatus}>
                        <SelectTrigger className="w-48" aria-label="Change status"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={KEEP}>Keep status</SelectItem>
                          {INCIDENT_STATUS_ORDER.filter((status) => status !== incident.status).map((status) => <SelectItem key={status} value={status}>{status === "RESOLVED" ? "Resolve incident" : `Move to ${INCIDENT_STATUS[status].label.toLowerCase()}`}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <label className={cn("flex items-center gap-2 text-sm", incident.isPublic ? "cursor-pointer text-text-2" : "text-faint")} title={incident.isPublic ? undefined : "Make the incident public first"}>
                        <Checkbox checked={publish && incident.isPublic} disabled={!incident.isPublic} onCheckedChange={(value) => setPublish(value === true)} />Publish to status page
                      </label>
                    </div>
                  ) : <p className="flex items-center gap-1.5 text-xs text-muted"><Lock className="size-3" />Stored separately from updates and never published.</p>}
                  <Button variant="primary" disabled={!message.trim()} loading={post.isPending} onClick={() => post.mutate()}>{mode === "note" ? "Add note" : nextStatus === "RESOLVED" ? "Post and resolve" : "Post update"}</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{view === "timeline" ? "Timeline" : "Activity history"}</CardTitle>
              <SegmentedControl label="View" value={view} onChange={setView} options={[{ value: "timeline", label: "Timeline" }, { value: "activity", label: "Activity" }]} />
            </CardHeader>
            <CardContent>
              {view === "timeline" ? (
                <ol>{[...incident.timeline].reverse().map((entry) => <TimelineItem key={`${entry.type}-${entry.id}`} entry={entry} />)}</ol>
              ) : activity.isPending ? <Skeleton className="h-32" /> : activity.isError ? <ErrorState className="py-6" onRetry={() => activity.refetch()} /> : activity.data.length === 0 ? <p className="text-sm text-muted">No recorded changes.</p> : (
                <ul className="flex flex-col divide-y divide-border">
                  {activity.data.map((entry) => (
                    <li key={entry.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                      <span><span className="font-medium">{entry.actorType === "SYSTEM" ? "PulseOps automation" : entry.actorLabel}</span> <span className="text-text-2">{entry.action.replace("incident.", "").replaceAll("_", " ")}</span></span>
                      <span className="shrink-0 text-xs text-muted">{formatDateTime(entry.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardContent className="pt-3">
              <dl className="divide-y divide-border">
                <SideRow label="Status"><IncidentStatusBadge status={incident.status} /></SideRow>
                <SideRow label="Severity">
                  {canWrite ? (
                    <Select value={incident.severity} onValueChange={(severity) => patch.mutate({ severity })}>
                      <SelectTrigger className="h-7 w-32" aria-label="Severity"><SelectValue /></SelectTrigger>
                      <SelectContent>{(Object.keys(SEVERITY) as IncidentSeverity[]).map((key) => <SelectItem key={key} value={key}>{SEVERITY[key].label}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : <SeverityBadge severity={incident.severity} />}
                </SideRow>
                <SideRow label="Owner">
                  {canWrite ? (
                    <Select value={incident.assignee?.id ?? UNASSIGNED} onValueChange={(value) => patch.mutate({ assigneeId: value === UNASSIGNED ? null : value })}>
                      <SelectTrigger className="h-7 w-40" aria-label="Owner"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value={UNASSIGNED}>Unassigned</SelectItem>{(members.data ?? (incident.assignee ? [{ userId: incident.assignee.id, name: incident.assignee.name }] : [])).map((member) => <SelectItem key={member.userId} value={member.userId}>{member.name}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : incident.assignee ? <span className="inline-flex items-center gap-1.5"><Avatar name={incident.assignee.name} size="sm" />{incident.assignee.name}</span> : <span className="text-muted">Unassigned</span>}
                </SideRow>
                <SideRow label="On status pages">{canWrite ? <Switch checked={incident.isPublic} onCheckedChange={(isPublic) => patch.mutate({ isPublic })} aria-label="Show on status pages" /> : incident.isPublic ? "Yes" : "No"}</SideRow>
                <SideRow label="Started">{formatDateTime(incident.startedAt)}</SideRow>
                {incident.resolvedAt && <SideRow label="Resolved">{formatDateTime(incident.resolvedAt)}</SideRow>}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Affected monitors</CardTitle>{canWrite && <Button size="sm" variant="ghost" onClick={() => { setLinked(incident.monitors.map((monitor) => monitor.id)); setLinking(true); }}>Edit</Button>}</CardHeader>
            <CardContent>
              {incident.monitors.length === 0 ? <p className="text-sm text-muted">No monitors linked.</p> : (
                <ul className="flex flex-col gap-2">
                  {incident.monitors.map((monitor) => (
                    <li key={monitor.id} className="flex items-center justify-between gap-2">
                      <Link href={org.paths.monitor(monitor.id)} className="truncate text-sm font-medium hover:underline">{monitor.name}</Link>
                      <MonitorStatusBadge status={monitor.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <AiPanel incidentId={incident.id} onUseDraft={(text) => { setMode("update"); setMessage(text); composerRef.current?.focus(); composerRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }} />
        </aside>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit incident</DialogTitle></DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium">Title<Input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} maxLength={140} /></label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">Summary<Textarea value={draftSummary} onChange={(event) => setDraftSummary(event.target.value)} maxLength={5000} /></label>
          </DialogBody>
          <DialogFooter><Button onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" disabled={draftTitle.trim().length < 3} loading={patch.isPending} onClick={() => patch.mutate({ title: draftTitle, summary: draftSummary }, { onSuccess: () => setEditing(false) })}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linking} onOpenChange={setLinking}>
        <DialogContent>
          <DialogHeader><DialogTitle>Affected monitors</DialogTitle></DialogHeader>
          <DialogBody><MonitorChecklist value={linked} onChange={setLinked} /></DialogBody>
          <DialogFooter><Button onClick={() => setLinking(false)}>Cancel</Button><Button variant="primary" loading={setMonitors.isPending} onClick={() => setMonitors.mutate()}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} destructive title={`Delete INC-${incident.number}?`} confirmLabel="Delete incident" loading={remove.isPending}
        description="The timeline, notes, and analyses are deleted with it. The deletion itself is recorded in the audit log. This cannot be undone." onConfirm={() => remove.mutate()} />
      <span className="sr-only" aria-live="polite">{incident.status}</span>
    </PageContainer>
  );
}
