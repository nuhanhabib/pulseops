"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Callout } from "@/components/ui/states";
import { useOrg } from "@/features/org/org-context";
import { api, errorMessage } from "@/lib/api-client";
import { routes } from "@/shared/routes";

export function GeneralSettings() {
  const org = useOrg();
  const canEdit = org.can("org:update");
  const [name, setName] = useState(org.organization.name);
  const [autoResolve, setAutoResolve] = useState(org.organization.autoResolveIncidents);
  const [confirm, setConfirm] = useState(false);
  const dirty = name !== org.organization.name || autoResolve !== org.organization.autoResolveIncidents;

  const save = useMutation({
    mutationFn: () => api.patch(org.api, { name, autoResolveIncidents: autoResolve }),
    // The name appears in the server-rendered shell, so reload it.
    onSuccess: () => { toast.success("Organization updated"); window.location.reload(); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(org.api, { confirm: org.organization.slug }),
    onSuccess: () => window.location.assign(routes.app),
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="flex flex-col gap-6">
      {!canEdit && <Callout tone="info">Your role can view these settings. Only owners and admins can change them.</Callout>}
      <Card>
        <CardHeader><CardTitle>Organization</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="Name"><Input value={name} onChange={(event) => setName(event.target.value)} disabled={!canEdit} maxLength={60} className="max-w-md" /></Field>
          <Field label="Address" hint="Part of every link, so it cannot be changed after creation."><Input value={`/org/${org.organization.slug}`} readOnly disabled className="max-w-md font-mono" /></Field>
          <label className="flex max-w-xl cursor-pointer items-start justify-between gap-4">
            <span><span className="block text-sm font-medium">Resolve automated incidents on recovery</span><span className="block text-xs text-muted">When every linked monitor is healthy again, close incidents that monitoring opened. Incidents declared by people are never closed automatically.</span></span>
            <Switch checked={autoResolve} onCheckedChange={setAutoResolve} disabled={!canEdit} aria-label="Resolve automated incidents on recovery" />
          </label>
        </CardContent>
        {canEdit && <CardFooter><Button variant="primary" disabled={!dirty || name.trim().length < 2} loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button></CardFooter>}
      </Card>

      {org.can("org:delete") && (
        <Card className="border-danger/30">
          <CardHeader><div><CardTitle>Delete organization</CardTitle><p className="mt-0.5 text-sm text-muted">Permanently deletes every monitor, check, incident, status page, and audit record. Public status pages stop working immediately.</p></div></CardHeader>
          <CardFooter><Button variant="danger" onClick={() => setConfirm(true)}>Delete organization</Button></CardFooter>
        </Card>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} destructive title={`Delete ${org.organization.name}?`} confirmLabel="Delete organization" confirmText={org.organization.slug} loading={remove.isPending}
        description="This removes all of the organization's data for every member. It cannot be undone." onConfirm={() => remove.mutate()} />
    </div>
  );
}
