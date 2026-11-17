"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink, EyeOff, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useBreadcrumbTitle } from "@/components/layout/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Switch } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { Field, FormSection } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout, ErrorState } from "@/components/ui/states";
import { StatusDot } from "@/components/ui/status";
import { orgKey, useOrg } from "@/features/org/org-context";
import { useOrgQuery } from "@/features/shared";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import type { StatusPageTheme } from "@/shared/enums";
import { routes } from "@/shared/routes";
import type { MonitorListItemDto, Paginated, StatusPageDto } from "@/shared/types";

interface Draft {
  name: string; description: string; accentColor: string; theme: StatusPageTheme; uptimeDays: number; showIncidentHistory: boolean; supportUrl: string;
  monitors: { monitorId: string; displayName: string; description: string }[];
}

const toDraft = (page: StatusPageDto): Draft => ({
  name: page.name, description: page.description ?? "", accentColor: page.accentColor, theme: page.theme, uptimeDays: page.uptimeDays,
  showIncidentHistory: page.showIncidentHistory, supportUrl: page.supportUrl ?? "",
  monitors: page.monitors.map((item) => ({ monitorId: item.monitorId, displayName: item.displayName, description: item.description ?? "" })),
});

const ACCENTS = ["#6366f1", "#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#64748b"];

function Editor({ page }: { page: StatusPageDto }) {
  const org = useOrg();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => toDraft(page));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const monitors = useOrgQuery<Paginated<MonitorListItemDto>>(["monitors", "picker"], "/monitors", { pageSize: 100 });
  const canWrite = org.can("statuspage:write");
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(page));
  const publicUrl = typeof window === "undefined" ? routes.statusPage(page.slug) : `${window.location.origin}${routes.statusPage(page.slug)}`;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const refresh = () => queryClient.invalidateQueries({ queryKey: orgKey(org.organization.slug, "status-pages") });
  const save = useMutation({
    mutationFn: (extra: { published?: boolean }) => api.patch<StatusPageDto>(`${org.api}/status-pages/${page.id}`, { ...draft, ...extra }),
    onSuccess: (saved, extra) => {
      setDraft(toDraft(saved));
      void refresh();
      toast.success(extra.published === true ? "Status page published" : extra.published === false ? "Status page unpublished" : "Changes saved");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`${org.api}/status-pages/${page.id}`),
    onSuccess: () => { void refresh(); toast.success("Status page deleted"); router.push(org.paths.statusPages); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const fields = save.error instanceof ApiError ? save.error.fields : {};

  const toggleMonitor = (monitor: MonitorListItemDto) =>
    set("monitors", draft.monitors.some((item) => item.monitorId === monitor.id)
      ? draft.monitors.filter((item) => item.monitorId !== monitor.id)
      // The public name starts empty on purpose: publishing an internal name must be a decision.
      : [...draft.monitors, { monitorId: monitor.id, displayName: "", description: "" }]);
  const move = (index: number, delta: number) => {
    const next = [...draft.monitors];
    const [item] = next.splice(index, 1);
    if (item) next.splice(index + delta, 0, item);
    set("monitors", next);
  };
  const patchMonitor = (index: number, patch: Partial<Draft["monitors"][number]>) => set("monitors", draft.monitors.map((item, position) => (position === index ? { ...item, ...patch } : item)));
  const unnamed = draft.monitors.some((item) => !item.displayName.trim());
  const privateName = (id: string) => monitors.data?.items.find((monitor) => monitor.id === id)?.name ?? page.monitors.find((item) => item.monitorId === id)?.monitorName ?? "Monitor";

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title={<>{page.name}<Badge tone={page.published ? "ok" : "neutral"}>{page.published ? "Published" : "Draft"}</Badge></>}
        meta={<span className="flex items-center gap-2 font-mono text-xs">{publicUrl}<CopyButton value={publicUrl} size="sm" variant="ghost" label="Copy link" /></span>}
        actions={<>
          {page.published && <Button asChild><a href={routes.statusPage(page.slug)} target="_blank" rel="noreferrer">View page<ExternalLink /></a></Button>}
          {canWrite && (page.published
            ? <Button onClick={() => save.mutate({ published: false })} loading={save.isPending && save.variables?.published === false}><EyeOff />Unpublish</Button>
            : <Button variant="primary" disabled={unnamed || draft.monitors.length === 0} onClick={() => save.mutate({ published: true })} loading={save.isPending && save.variables?.published === true}>Save and publish</Button>)}
        </>}
      />
      {!page.published && <Callout tone="info" className="mb-4">This page is a draft. Its address returns “not found” to visitors until you publish it.</Callout>}

      <Card className="px-5 py-5 sm:px-6">
        <fieldset disabled={!canWrite} className="min-w-0">
          <FormSection title="Page" description="How the page introduces itself to visitors.">
            <Field label="Name" error={fields.name?.[0]}><Input value={draft.name} onChange={(event) => set("name", event.target.value)} /></Field>
            <Field label="Description" optional error={fields.description?.[0]}><Textarea value={draft.description} onChange={(event) => set("description", event.target.value)} maxLength={280} placeholder="Live status and incident history for our services." /></Field>
            <Field label="Support link" optional hint="Shown in the page footer." error={fields.supportUrl?.[0]}><Input value={draft.supportUrl} onChange={(event) => set("supportUrl", event.target.value)} type="url" placeholder="https://support.example.com" /></Field>
          </FormSection>

          <FormSection title="Components" description="Only the monitors you tick are shown, under the public names you give them. Internal names and URLs are never published.">
            {monitors.isPending ? <Skeleton className="h-32" /> : (
              <ul className="max-h-56 overflow-y-auto rounded-md border border-border-strong">
                {(monitors.data?.items ?? []).map((monitor) => (
                  <li key={monitor.id} className="border-b border-border last:border-b-0">
                    <label className="flex h-9 cursor-pointer items-center gap-2.5 px-2.5 text-sm hover:bg-surface-2">
                      <Checkbox checked={draft.monitors.some((item) => item.monitorId === monitor.id)} onCheckedChange={() => toggleMonitor(monitor)} />
                      <StatusDot status={monitor.status} /><span className="truncate">{monitor.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {draft.monitors.length > 0 && (
              <ol className="flex flex-col gap-2">
                {draft.monitors.map((item, index) => (
                  <li key={item.monitorId} className="rounded-lg border border-border bg-surface-2 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted">
                      <span className="truncate">Private monitor: <span className="text-text-2">{privateName(item.monitorId)}</span></span>
                      <span className="flex shrink-0 gap-0.5">
                        <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button>
                        <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={index === draft.monitors.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button>
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input value={item.displayName} onChange={(event) => patchMonitor(index, { displayName: event.target.value })} placeholder="Public name, e.g. Checkout" aria-label={`Public name for ${privateName(item.monitorId)}`} aria-invalid={!item.displayName.trim() || undefined} maxLength={60} />
                      <Input value={item.description} onChange={(event) => patchMonitor(index, { description: event.target.value })} placeholder="Short description (optional)" aria-label="Public description" maxLength={160} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {unnamed && <p className="text-xs text-warn-fg">Give every component a public name before saving.</p>}
          </FormSection>

          <FormSection title="Appearance" description="Applied to the public page only.">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Accent colour</span>
              <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Accent colour">
                {ACCENTS.map((color) => (
                  <button key={color} type="button" role="radio" aria-checked={draft.accentColor === color} aria-label={color} onClick={() => set("accentColor", color)}
                    className="size-7 rounded-full border-2 border-transparent ring-offset-2 ring-offset-surface aria-checked:ring-2 aria-checked:ring-text" style={{ background: color }} />
                ))}
                <Input value={draft.accentColor} onChange={(event) => set("accentColor", event.target.value)} className="w-28 font-mono" aria-label="Accent colour hex" aria-invalid={Boolean(fields.accentColor) || undefined} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Theme">
                <Select value={draft.theme} onValueChange={(value) => set("theme", value as StatusPageTheme)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="AUTO">Match the visitor&apos;s system</SelectItem><SelectItem value="DARK">Dark</SelectItem><SelectItem value="LIGHT">Light</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Uptime history">
                <Select value={String(draft.uptimeDays)} onValueChange={(value) => set("uptimeDays", Number(value))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="30">30 days</SelectItem><SelectItem value="60">60 days</SelectItem><SelectItem value="90">90 days</SelectItem></SelectContent>
                </Select>
              </Field>
            </div>
            <label className="flex cursor-pointer items-start justify-between gap-4">
              <span><span className="block text-sm font-medium">Show incident history</span><span className="block text-xs text-muted">Resolved public incidents from the last 14 days. Active public incidents are always shown.</span></span>
              <Switch checked={draft.showIncidentHistory} onCheckedChange={(value) => set("showIncidentHistory", value)} aria-label="Show incident history" />
            </label>
          </FormSection>
        </fieldset>

        {canWrite && (
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)}><Trash2 />Delete page</Button>
            <div className="flex gap-2">
              <Button disabled={!dirty} onClick={() => setDraft(toDraft(page))}>Discard</Button>
              <Button variant="primary" disabled={!dirty || unnamed} loading={save.isPending && save.variables?.published === undefined} onClick={() => save.mutate({})}>Save changes</Button>
            </div>
          </div>
        )}
      </Card>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} destructive title={`Delete ${page.name}?`} confirmLabel="Delete status page" loading={remove.isPending}
        description="The public address stops working immediately. Monitors and incidents are not affected." onConfirm={() => remove.mutate()} />
    </PageContainer>
  );
}

export function StatusPageEditorPage({ statusPageId }: { statusPageId: string }) {
  const page = useOrgQuery<StatusPageDto>(["status-pages", statusPageId], `/status-pages/${statusPageId}`);
  useBreadcrumbTitle(page.data?.name);
  if (page.isError) return <PageContainer><Card><ErrorState title="Status page not found" onRetry={() => page.refetch()} /></Card></PageContainer>;
  if (!page.data) return <PageContainer className="max-w-4xl"><Skeleton className="h-8 w-64" /><Skeleton className="mt-6 h-96" /></PageContainer>;
  // Re-keyed on save so the editor's baseline follows the stored page.
  return <Editor key={page.data.updatedAt} page={page.data} />;
}
