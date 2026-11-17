"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FlaskConical, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/checkbox";
import { Field, FormSection } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Callout } from "@/components/ui/states";
import { SEVERITY } from "@/components/ui/status";
import { orgKey, useOrg } from "@/features/org/org-context";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { MONITOR_DEFAULTS, MONITOR_INTERVAL_OPTIONS } from "@/shared/constants";
import { HttpMethod, type IncidentSeverity, MonitorKind } from "@/shared/enums";
import { formatMs } from "@/shared/format";
import { type CreateMonitorFormValues, type CreateMonitorInput, createMonitorSchema } from "@/shared/schemas/monitor";
import type { MonitorDto, TestCheckResultDto } from "@/shared/types";

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span><span className="block text-sm font-medium text-text">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

/** Create and edit share one form. Validation is the same Zod schema the API uses. */
export function MonitorForm({ monitor }: { monitor?: MonitorDto }) {
  const org = useOrg();
  const router = useRouter();
  const queryClient = useQueryClient();
  const editing = Boolean(monitor);

  const form = useForm<CreateMonitorFormValues, unknown, CreateMonitorInput>({
    resolver: zodResolver(createMonitorSchema),
    defaultValues: monitor
      ? { ...monitor, category: monitor.category ?? "" }
      : { ...MONITOR_DEFAULTS, name: "", url: "", category: "" },
  });
  const { register, control, handleSubmit, getValues, setError, formState: { errors, isDirty } } = form;

  const save = useMutation({
    mutationFn: (input: CreateMonitorInput) =>
      monitor ? api.patch<MonitorDto>(`${org.api}/monitors/${monitor.id}`, input) : api.post<MonitorDto>(`${org.api}/monitors`, input),
    onSuccess: (saved) => {
      toast.success(editing ? "Monitor updated" : "Monitor created", { description: editing ? undefined : "The first check runs within a few seconds." });
      void queryClient.invalidateQueries({ queryKey: orgKey(org.organization.slug) });
      router.push(org.paths.monitor(saved.id));
    },
    onError: (error) => {
      // Server-side validation (SSRF policy, duplicate names) lands on the field it belongs to.
      if (error instanceof ApiError && Object.keys(error.fields).length > 0) {
        for (const [field, messages] of Object.entries(error.fields)) setError(field as keyof CreateMonitorFormValues, { message: messages[0] });
        toast.error("Check the highlighted fields.");
      } else toast.error(errorMessage(error));
    },
  });

  const test = useMutation({
    mutationFn: () => {
      const values = getValues();
      return api.post<TestCheckResultDto>(`${org.api}/monitors/test`, {
        url: values.url, method: values.method, timeoutMs: values.timeoutMs, expectedStatusCodes: values.expectedStatusCodes, followRedirects: values.followRedirects,
      });
    },
  });
  const testError = test.error instanceof ApiError ? (test.error.fields.url?.[0] ?? test.error.message) : test.error ? errorMessage(test.error) : null;
  const number = { setValueAs: (value: unknown) => (value === "" || value === null ? undefined : Number(value)) };

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title={editing ? `Edit ${monitor!.name}` : "New monitor"} description={editing ? "Changes apply from the next check." : "Tell PulseOps what to check, how often, and when to call it an outage."} />
      <form onSubmit={handleSubmit((values) => save.mutate(values))} noValidate>
        <Card className="px-5 py-5 sm:px-6">
          <FormSection title="Target" description="The endpoint to request. Private and internal addresses are blocked.">
            <Field label="Name" error={errors.name?.message}><Input {...register("name")} placeholder="Checkout API" autoFocus={!editing} /></Field>
            <div className="grid gap-4 sm:grid-cols-[7.5rem_1fr]">
              <Field label="Method">
                <Controller control={control} name="method" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.values(HttpMethod).map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </Field>
              <Field label="URL" error={errors.url?.message}><Input {...register("url")} type="url" inputMode="url" placeholder="https://api.example.com/health" className="font-mono" spellCheck={false} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type">
                <Controller control={control} name="kind" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value={MonitorKind.WEBSITE}>Website</SelectItem><SelectItem value={MonitorKind.API}>API endpoint</SelectItem></SelectContent>
                  </Select>
                )} />
              </Field>
              <Field label="Category" optional hint="Used to group and filter monitors." error={errors.category?.message}><Input {...register("category")} placeholder="Customer-facing" /></Field>
            </div>

            <div className="rounded-lg border border-border bg-surface-2 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-sm font-medium text-text">Test this configuration</p><p className="text-xs text-muted">Runs one real check now. Nothing is saved.</p></div>
                <Button onClick={() => test.mutate()} loading={test.isPending}><FlaskConical />Run test</Button>
              </div>
              <div aria-live="polite">
                {test.data && !test.isPending && (
                  <div className="mt-3 flex items-start gap-2.5 border-t border-border pt-3 text-sm">
                    {test.data.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok-fg" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger-fg" />}
                    <div className="min-w-0">
                      <p className="font-medium text-text">{test.data.ok ? `Responded with HTTP ${test.data.statusCode} in ${formatMs(test.data.responseTimeMs)}` : (test.data.errorMessage ?? "The check failed.")}</p>
                      <p className="text-xs text-muted">
                        {test.data.ok
                          ? [test.data.timings.dnsMs !== null && `DNS ${test.data.timings.dnsMs} ms`, test.data.timings.connectMs !== null && `connect ${test.data.timings.connectMs} ms`, test.data.timings.tlsMs !== null && `TLS ${test.data.timings.tlsMs} ms`, test.data.redirects > 0 && `${test.data.redirects} redirect${test.data.redirects === 1 ? "" : "s"}`].filter(Boolean).join(" · ") || "Looks good."
                          : "Fix the target or the expected status codes, then test again."}
                      </p>
                    </div>
                  </div>
                )}
                {testError && !test.isPending && <p role="alert" className="mt-3 border-t border-border pt-3 text-sm text-danger-fg">{testError}</p>}
              </div>
            </div>
          </FormSection>

          <FormSection title="Schedule" description="How often to check, and how long to wait for an answer.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Check every" error={errors.intervalSeconds?.message}>
                <Controller control={control} name="intervalSeconds" render={({ field }) => (
                  <Select value={String(field.value)} onValueChange={(value) => field.onChange(Number(value))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{MONITOR_INTERVAL_OPTIONS.map((option) => <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </Field>
              <Field label="Timeout (ms)" hint="Give up on a request after this long." error={errors.timeoutMs?.message}><Input type="number" inputMode="numeric" step={500} {...register("timeoutMs", number)} /></Field>
              <Field label="Expected status codes" hint="Codes or ranges, comma separated." error={errors.expectedStatusCodes?.message}><Input {...register("expectedStatusCodes")} className="font-mono" placeholder="200-299" /></Field>
              <Field label="Retries per check" hint="Immediate re-tries before a check counts as failed." error={errors.retries?.message}><Input type="number" inputMode="numeric" min={0} max={3} {...register("retries", number)} /></Field>
            </div>
            <Controller control={control} name="followRedirects" render={({ field }) => <ToggleRow label="Follow redirects" hint="Up to 5 hops. Every hop is re-validated against the network policy." checked={field.value ?? true} onChange={field.onChange} />} />
          </FormSection>

          <FormSection title="Outage policy" description="Thresholds stop one blip from paging anyone, and one lucky success from hiding an outage.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Failures before down" error={errors.failureThreshold?.message}><Input type="number" inputMode="numeric" min={1} max={10} {...register("failureThreshold", number)} /></Field>
              <Field label="Successes to recover" error={errors.recoveryThreshold?.message}><Input type="number" inputMode="numeric" min={1} max={10} {...register("recoveryThreshold", number)} /></Field>
              <Field label="Degraded above (ms)" optional hint="Leave empty to disable." error={errors.degradedThresholdMs?.message}>
                <Input type="number" inputMode="numeric" step={100} {...register("degradedThresholdMs", { setValueAs: (value: unknown) => (value === "" || value === null || value === undefined ? null : Number(value)) })} />
              </Field>
            </div>
            <Controller control={control} name="autoIncident" render={({ field }) => <ToggleRow label="Open an incident automatically" hint="When the failure threshold is reached. Repeated failures never open duplicates." checked={field.value ?? true} onChange={field.onChange} />} />
            <Field label="Incident severity" hint="Applied to incidents opened automatically for this monitor." className="sm:max-w-xs">
              <Controller control={control} name="incidentSeverity" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(SEVERITY) as IncidentSeverity[]).map((key) => <SelectItem key={key} value={key}>{SEVERITY[key].label}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </Field>
            <Controller control={control} name="enabled" render={({ field }) => <ToggleRow label="Monitoring enabled" hint="Paused monitors keep their history but run no checks." checked={field.value ?? true} onChange={field.onChange} />} />
          </FormSection>

          {Object.keys(errors).length > 0 && <Callout tone="danger" className="mb-4">Some fields need attention before this can be saved.</Callout>}
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button asChild><Link href={monitor ? org.paths.monitor(monitor.id) : org.paths.monitors}>Cancel</Link></Button>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={editing && !isDirty}>{editing ? "Save changes" : "Create monitor"}</Button>
          </div>
        </Card>
      </form>
    </PageContainer>
  );
}
