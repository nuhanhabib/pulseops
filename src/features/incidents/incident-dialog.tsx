"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox, Switch } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SEVERITY, StatusDot } from "@/components/ui/status";
import { orgKey, useOrg } from "@/features/org/org-context";
import { useOrgQuery } from "@/features/shared";
import { api, errorMessage } from "@/lib/api-client";
import type { IncidentSeverity } from "@/shared/enums";
import { type CreateIncidentFormValues, type CreateIncidentInput, createIncidentSchema } from "@/shared/schemas/incident";
import type { IncidentDetailDto, MemberDto, MonitorListItemDto, Paginated } from "@/shared/types";

const UNASSIGNED = "__none";

export function MonitorChecklist({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const monitors = useOrgQuery<Paginated<MonitorListItemDto>>(["monitors", "picker"], "/monitors", { pageSize: 100 });
  if (monitors.isPending) return <p className="text-sm text-muted">Loading monitors…</p>;
  if (!monitors.data?.items.length) return <p className="text-sm text-muted">No monitors to link yet.</p>;
  return (
    <ul className="max-h-44 overflow-y-auto rounded-md border border-border-strong">
      {monitors.data.items.map((monitor) => {
        const checked = value.includes(monitor.id);
        return (
          <li key={monitor.id} className="border-b border-border last:border-b-0">
            <label className="flex h-9 cursor-pointer items-center gap-2.5 px-2.5 text-sm hover:bg-surface-2">
              <Checkbox checked={checked} onCheckedChange={() => onChange(checked ? value.filter((id) => id !== monitor.id) : [...value, monitor.id])} />
              <StatusDot status={monitor.status} /><span className="truncate">{monitor.name}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export function IncidentDialog({ open, onOpenChange, defaultMonitorIds = [] }: { open: boolean; onOpenChange: (open: boolean) => void; defaultMonitorIds?: string[] }) {
  const org = useOrg();
  const router = useRouter();
  const queryClient = useQueryClient();
  const members = useOrgQuery<MemberDto[]>(["members"], "/members", undefined, { enabled: open });
  const form = useForm<CreateIncidentFormValues, unknown, CreateIncidentInput>({
    resolver: zodResolver(createIncidentSchema),
    defaultValues: { title: "", summary: "", severity: "MEDIUM", status: "INVESTIGATING", monitorIds: defaultMonitorIds, assigneeId: org.user.id, isPublic: false },
  });
  const { register, control, handleSubmit, reset, formState: { errors } } = form;
  const create = useMutation({
    mutationFn: (input: CreateIncidentInput) => api.post<IncidentDetailDto>(`${org.api}/incidents`, input),
    onSuccess: (incident) => {
      toast.success(`INC-${incident.number} opened`);
      void queryClient.invalidateQueries({ queryKey: orgKey(org.organization.slug) });
      onOpenChange(false);
      reset();
      router.push(org.paths.incident(incident.id));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form onSubmit={handleSubmit((values) => create.mutate(values))} noValidate className="flex min-h-0 flex-col">
          <DialogHeader><DialogTitle>Declare an incident</DialogTitle><DialogDescription>Opens a timeline your team can coordinate in. Members with incident notifications on are told immediately.</DialogDescription></DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Title" error={errors.title?.message}><Input {...register("title")} placeholder="Checkout requests are timing out" autoFocus /></Field>
            <Field label="Summary" optional error={errors.summary?.message}><Textarea {...register("summary")} placeholder="What is known so far, and who is affected." /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Severity">
                <Controller control={control} name="severity" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{(Object.keys(SEVERITY) as IncidentSeverity[]).map((key) => <SelectItem key={key} value={key}>{SEVERITY[key].label}</SelectItem>)}</SelectContent></Select>
                )} />
              </Field>
              <Field label="Owner">
                <Controller control={control} name="assigneeId" render={({ field }) => (
                  <Select value={field.value ?? UNASSIGNED} onValueChange={(value) => field.onChange(value === UNASSIGNED ? null : value)}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value={UNASSIGNED}>Unassigned</SelectItem>{(members.data ?? [{ userId: org.user.id, name: org.user.name }]).map((member) => <SelectItem key={member.userId} value={member.userId}>{member.name}</SelectItem>)}</SelectContent></Select>
                )} />
              </Field>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Affected monitors <span className="font-normal text-muted">(optional)</span></span>
              <Controller control={control} name="monitorIds" render={({ field }) => <MonitorChecklist value={field.value ?? []} onChange={field.onChange} />} />
            </div>
            <Controller control={control} name="isPublic" render={({ field }) => (
              <label className="flex cursor-pointer items-start justify-between gap-4">
                <span><span className="block text-sm font-medium">Show on status pages</span><span className="block text-xs text-muted">Only the title, status, and updates you mark as public are published.</span></span>
                <Switch checked={field.value ?? false} onCheckedChange={field.onChange} aria-label="Show on status pages" />
              </label>
            )} />
          </DialogBody>
          <DialogFooter><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" variant="primary" loading={create.isPending}>Declare incident</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
