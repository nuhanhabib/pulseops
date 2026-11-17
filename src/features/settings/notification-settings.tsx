"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Plus, Trash2, Webhook } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Switch } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RelativeTime } from "@/components/ui/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout, EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableContainer, Td, Th, Tr } from "@/components/ui/table";
import { SegmentedControl } from "@/components/ui/tabs";
import { orgKey, useOrg } from "@/features/org/org-context";
import { useOrgQuery } from "@/features/shared";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import type { DeliveryStatus, NotificationEvent } from "@/shared/enums";
import type { CreatedChannelDto, CursorPage, NotificationChannelDto, NotificationDeliveryDto, NotificationPreferencesDto, NotificationSettingsDto } from "@/shared/types";

const EVENTS: { value: NotificationEvent; label: string; pref: keyof NotificationPreferencesDto; hint: string }[] = [
  { value: "INCIDENT_CREATED", label: "Incident opened", pref: "notifyIncidentCreated", hint: "Automatic or declared by a teammate." },
  { value: "INCIDENT_RESOLVED", label: "Incident resolved", pref: "notifyIncidentResolved", hint: "Including automatic resolution on recovery." },
  { value: "MONITOR_DOWN", label: "Monitor down", pref: "notifyMonitorDown", hint: "When a monitor crosses its failure threshold." },
  { value: "MONITOR_RECOVERED", label: "Monitor recovered", pref: "notifyMonitorRecovered", hint: "When a down monitor is healthy again." },
];
const EVENT_LABEL = Object.fromEntries(EVENTS.map((event) => [event.value, event.label])) as Record<NotificationEvent, string>;
const DELIVERY: Record<DeliveryStatus, { label: string; tone: BadgeTone }> = {
  SENT: { label: "Sent", tone: "ok" }, PENDING: { label: "Pending", tone: "info" }, FAILED: { label: "Failed", tone: "danger" },
  SKIPPED: { label: "Not sent", tone: "neutral" }, SUPPRESSED: { label: "Rate limited", tone: "warn" },
};

function Deliveries() {
  const org = useOrg();
  const deliveries = useInfiniteQuery({
    queryKey: orgKey(org.organization.slug, "notifications", "deliveries"),
    queryFn: ({ pageParam }) => api.get<CursorPage<NotificationDeliveryDto>>(`${org.api}/notifications/deliveries`, { limit: 20, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  if (deliveries.isPending) return <div className="p-5"><Skeleton className="h-32" /></div>;
  if (deliveries.isError) return <ErrorState onRetry={() => deliveries.refetch()} />;
  const rows = deliveries.data.pages.flatMap((page) => page.items);
  if (rows.length === 0) return <EmptyState icon={Mail} title="Nothing delivered yet" description="Every notification attempt is recorded here, including ones that were skipped or failed." className="py-10" />;
  return (
    <>
      <TableContainer>
        <Table>
          <thead><tr><Th>Notification</Th><Th>To</Th><Th>Result</Th><Th className="hidden md:table-cell">Detail</Th><Th className="text-right">When</Th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td className="h-11 max-w-0 w-[36%]"><span className="block truncate">{row.subject}</span><span className="block text-xs text-muted">{EVENT_LABEL[row.event]}</span></Td>
                <Td className="h-11 whitespace-nowrap"><span className="flex items-center gap-1.5 text-text-2">{row.channelType === "EMAIL" ? <Mail className="size-3.5" /> : <Webhook className="size-3.5" />}{row.destination}</span></Td>
                <Td className="h-11"><Badge tone={DELIVERY[row.status].tone}>{DELIVERY[row.status].label}</Badge></Td>
                <Td className="hidden h-11 max-w-56 truncate text-xs text-muted md:table-cell" title={row.lastError ?? undefined}>{row.lastError ?? (row.attempts > 1 ? `Delivered on attempt ${row.attempts}` : "")}</Td>
                <Td className="h-11 text-right whitespace-nowrap text-text-2"><RelativeTime date={row.createdAt} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableContainer>
      {deliveries.hasNextPage && <div className="border-t border-border p-3 text-center"><Button onClick={() => deliveries.fetchNextPage()} loading={deliveries.isFetchingNextPage}>Load more</Button></div>}
    </>
  );
}

export function NotificationSettings() {
  const org = useOrg();
  const queryClient = useQueryClient();
  const settingsKey = orgKey(org.organization.slug, "notifications", "settings", {});
  const settings = useOrgQuery<NotificationSettingsDto>(["notifications", "settings"], "/notifications");
  const canManage = org.can("notification:manage");
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState<"EMAIL" | "WEBHOOK">("EMAIL");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [events, setEvents] = useState<NotificationEvent[]>(["INCIDENT_CREATED", "INCIDENT_RESOLVED"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<NotificationChannelDto | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orgKey(org.organization.slug, "notifications") });
  const onError = (error: unknown) => toast.error(errorMessage(error));

  const savePrefs = useMutation({
    mutationFn: (preferences: NotificationPreferencesDto) => api.put<NotificationPreferencesDto>(`${org.api}/notifications/preferences`, preferences),
    // Optimistic: a toggle should move immediately, and roll back if the server refuses.
    onMutate: async (preferences) => {
      await queryClient.cancelQueries({ queryKey: settingsKey });
      const previous = queryClient.getQueryData<NotificationSettingsDto>(settingsKey);
      if (previous) queryClient.setQueryData(settingsKey, { ...previous, preferences });
      return { previous };
    },
    onError: (error, _input, context) => { if (context?.previous) queryClient.setQueryData(settingsKey, context.previous); onError(error); },
  });
  const create = useMutation({
    mutationFn: () => api.post<CreatedChannelDto>(`${org.api}/notifications/channels`, type === "EMAIL"
      ? { type, name, events, recipients: target.split(/[\s,;]+/).filter(Boolean) } : { type, name, events, url: target.trim() }),
    onSuccess: (channel) => { void refresh(); if (channel.signingSecret) setSecret(channel.signingSecret); else { setCreating(false); toast.success("Channel added"); } },
  });
  const toggle = useMutation({ mutationFn: (channel: NotificationChannelDto) => api.patch(`${org.api}/notifications/channels/${channel.id}`, { enabled: !channel.enabled }), onSuccess: () => void refresh(), onError });
  const remove = useMutation({ mutationFn: (channel: NotificationChannelDto) => api.delete(`${org.api}/notifications/channels/${channel.id}`), onSuccess: () => { setDeleting(null); toast.success("Channel deleted"); void refresh(); }, onError });
  const fields = create.error instanceof ApiError ? create.error.fields : {};
  const targetError = fields.recipients?.[0] ?? fields.url?.[0] ?? Object.entries(fields).find(([key]) => key.startsWith("recipients"))?.[1]?.[0];

  if (settings.isError) return <Card><ErrorState onRetry={() => settings.refetch()} /></Card>;
  const data = settings.data;
  const openCreate = () => { setType("EMAIL"); setName(""); setTarget(""); setSecret(null); create.reset(); setCreating(true); };

  return (
    <div className="flex flex-col gap-6">
      {data && !data.emailConfigured && (
        <Callout tone="warn" icon={Mail} title="Email is not configured on this instance">
          Notifications are still generated and recorded in the delivery log below, marked “Not sent”. Set <code className="font-mono text-xs">SMTP_URL</code> to deliver them. Webhook channels work without it.
        </Callout>
      )}

      <Card>
        <CardHeader><div><CardTitle>Email me about</CardTitle><p className="mt-0.5 text-sm text-muted">Your own preferences for {org.organization.name}, sent to {org.user.email}.</p></div></CardHeader>
        <CardContent className="flex flex-col divide-y divide-border">
          {!data ? <Skeleton className="h-40" /> : EVENTS.map((event) => (
            <label key={event.value} className="flex cursor-pointer items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <span><span className="block text-sm font-medium">{event.label}</span><span className="block text-xs text-muted">{event.hint}</span></span>
              <Switch checked={data.preferences[event.pref]} onCheckedChange={(value) => savePrefs.mutate({ ...data.preferences, [event.pref]: value })} aria-label={event.label} />
            </label>
          ))}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <div><CardTitle>Channels</CardTitle><p className="mt-0.5 text-sm text-muted">Shared destinations: distribution lists and signed webhooks.</p></div>
          {canManage && <Button onClick={openCreate}><Plus />Add channel</Button>}
        </CardHeader>
        {!data ? <div className="p-5"><Skeleton className="h-20" /></div> : data.channels.length === 0 ? (
          <EmptyState icon={Webhook} title="No channels" description="Add an email list or a webhook to notify people and systems beyond individual members." className="py-10" />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {data.channels.map((channel) => (
              <li key={channel.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">{channel.type === "EMAIL" ? <Mail className="size-4" /> : <Webhook className="size-4" />}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">{channel.name}{!channel.enabled && <Badge>Disabled</Badge>}</p>
                  <p className="truncate font-mono text-xs text-muted">{channel.type === "EMAIL" ? channel.recipients.join(", ") : channel.url}</p>
                  <p className="mt-1 flex flex-wrap gap-1">{channel.events.map((event) => <Badge key={event} tone="outline">{EVENT_LABEL[event]}</Badge>)}</p>
                </div>
                {canManage && <div className="flex items-center gap-2"><Switch checked={channel.enabled} onCheckedChange={() => toggle.mutate(channel)} aria-label={`Enable ${channel.name}`} /><Button size="icon-sm" variant="danger-ghost" aria-label={`Delete ${channel.name}`} onClick={() => setDeleting(channel)}><Trash2 /></Button></div>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader><div><CardTitle>Delivery log</CardTitle><p className="mt-0.5 text-sm text-muted">Failed deliveries are retried up to five times with increasing delays.</p></div></CardHeader>
        <Deliveries />
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          {secret ? (
            <>
              <DialogHeader><DialogTitle>Webhook signing secret</DialogTitle><DialogDescription>Each request carries an HMAC-SHA256 signature of “timestamp.body” in X-PulseOps-Signature. Store this secret now; it is not shown again.</DialogDescription></DialogHeader>
              <DialogBody><div className="flex gap-2"><Input readOnly value={secret} className="font-mono text-xs" aria-label="Signing secret" /><CopyButton value={secret} variant="primary" /></div></DialogBody>
              <DialogFooter><Button onClick={() => setCreating(false)}>Done</Button></DialogFooter>
            </>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
              <DialogHeader><DialogTitle>Add a notification channel</DialogTitle></DialogHeader>
              <DialogBody className="flex flex-col gap-4">
                <SegmentedControl label="Channel type" value={type} onChange={(value) => { setType(value); setTarget(""); }} options={[{ value: "EMAIL", label: "Email list" }, { value: "WEBHOOK", label: "Webhook" }]} className="self-start" />
                <Field label="Name" error={fields.name?.[0]}><Input value={name} onChange={(event) => setName(event.target.value)} placeholder={type === "EMAIL" ? "On-call list" : "Ops automation"} /></Field>
                <Field label={type === "EMAIL" ? "Recipients" : "Endpoint URL"} hint={type === "EMAIL" ? "Separate addresses with commas." : "Receives a signed JSON POST. Private addresses are blocked."} error={targetError}>
                  <Input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={type === "EMAIL" ? "oncall@company.com, ops@company.com" : "https://hooks.company.com/pulseops"} className={type === "WEBHOOK" ? "font-mono" : undefined} />
                </Field>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium">Send for</legend>
                  {EVENTS.map((event) => (
                    <label key={event.value} className="flex cursor-pointer items-center gap-2.5 text-sm">
                      <Checkbox checked={events.includes(event.value)} onCheckedChange={() => setEvents(events.includes(event.value) ? events.filter((item) => item !== event.value) : [...events, event.value])} />{event.label}
                    </label>
                  ))}
                  {fields.events?.[0] && <p role="alert" className="text-xs text-danger-fg">{fields.events[0]}</p>}
                </fieldset>
                {create.error && Object.keys(fields).length === 0 && <p role="alert" className="text-sm text-danger-fg">{errorMessage(create.error)}</p>}
              </DialogBody>
              <DialogFooter><Button onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" variant="primary" loading={create.isPending} disabled={!name.trim() || !target.trim() || events.length === 0}>Add channel</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)} destructive title={`Delete ${deleting?.name ?? "channel"}?`} confirmLabel="Delete channel" loading={remove.isPending}
        description="It stops receiving notifications immediately. Its past deliveries stay in the log." onConfirm={() => deleting && remove.mutate(deleting)} />
    </div>
  );
}
