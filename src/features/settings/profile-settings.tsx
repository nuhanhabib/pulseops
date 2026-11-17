"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { type ThemeChoice, useTheme } from "@/components/providers/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RelativeTime } from "@/components/ui/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { useOrg } from "@/features/org/org-context";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { type ChangePasswordInput, changePasswordSchema } from "@/shared/schemas/auth";
import type { SessionDto } from "@/shared/types";

export function ProfileSettings() {
  const org = useOrg();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(org.user.name);
  const sessions = useQuery({ queryKey: ["me", "sessions"], queryFn: () => api.get<SessionDto[]>("/api/v1/me/sessions") });
  const onError = (error: unknown) => toast.error(errorMessage(error));

  const saveName = useMutation({ mutationFn: () => api.patch("/api/v1/me", { name }), onSuccess: () => { toast.success("Profile updated"); window.location.reload(); }, onError });
  const password = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: "", newPassword: "" } });
  const changePassword = useMutation({
    mutationFn: (input: ChangePasswordInput) => api.post<{ revokedSessions: number }>("/api/v1/me/password", input),
    onSuccess: (result) => { password.reset(); void queryClient.invalidateQueries({ queryKey: ["me", "sessions"] }); toast.success("Password changed", { description: result.revokedSessions ? `Signed out ${result.revokedSessions} other device${result.revokedSessions === 1 ? "" : "s"}.` : undefined }); },
    onError: (error) => {
      if (error instanceof ApiError && Object.keys(error.fields).length) for (const [field, messages] of Object.entries(error.fields)) password.setError(field as keyof ChangePasswordInput, { message: messages[0] });
      else onError(error);
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/api/v1/me/sessions/${id}`), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["me", "sessions"] }), onError });
  const revokeOthers = useMutation({ mutationFn: () => api.delete<{ revokedSessions: number }>("/api/v1/me/sessions"), onSuccess: () => { toast.success("Signed out of other devices"); void queryClient.invalidateQueries({ queryKey: ["me", "sessions"] }); }, onError });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent className="flex max-w-md flex-col gap-4">
          <Field label="Name"><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="name" /></Field>
          <Field label="Email" hint="Used to sign in and for notifications."><Input value={org.user.email} readOnly disabled /></Field>
        </CardContent>
        <CardFooter><Button variant="primary" disabled={name.trim().length < 2 || name === org.user.name} loading={saveName.isPending} onClick={() => saveName.mutate()}>Save</Button></CardFooter>
      </Card>

      <Card>
        <CardHeader><div><CardTitle>Appearance</CardTitle><p className="mt-0.5 text-sm text-muted">Stored in this browser.</p></div></CardHeader>
        <CardContent><SegmentedControl<ThemeChoice> label="Theme" value={theme} onChange={setTheme} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]} /></CardContent>
      </Card>

      <Card>
        <form onSubmit={password.handleSubmit((values) => changePassword.mutate(values))} noValidate>
          <CardHeader><div><CardTitle>Password</CardTitle><p className="mt-0.5 text-sm text-muted">Changing it signs you out everywhere else.</p></div></CardHeader>
          <CardContent className="flex max-w-md flex-col gap-4">
            <Field label="Current password" error={password.formState.errors.currentPassword?.message}><Input type="password" autoComplete="current-password" {...password.register("currentPassword")} /></Field>
            <Field label="New password" hint="At least 10 characters, mixing letters with a number or symbol." error={password.formState.errors.newPassword?.message}><Input type="password" autoComplete="new-password" {...password.register("newPassword")} /></Field>
          </CardContent>
          <CardFooter><Button type="submit" variant="primary" loading={changePassword.isPending}>Change password</Button></CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <div><CardTitle>Active sessions</CardTitle><p className="mt-0.5 text-sm text-muted">Devices currently signed in to your account.</p></div>
          {(sessions.data?.length ?? 0) > 1 && <Button onClick={() => revokeOthers.mutate()} loading={revokeOthers.isPending}>Sign out others</Button>}
        </CardHeader>
        <CardContent>
          {sessions.isPending ? <Skeleton className="h-20" /> : sessions.isError ? <p className="text-sm text-muted">Could not load sessions.</p> : (
            <ul className="divide-y divide-border">
              {sessions.data.map((session) => (
                <li key={session.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <MonitorSmartphone className="size-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1"><p className="flex items-center gap-2 text-sm font-medium">{session.device}{session.current && <Badge tone="ok">This device</Badge>}</p><p className="text-xs text-muted">{session.ipAddress ?? "Unknown address"} · active <RelativeTime date={session.lastUsedAt} /></p></div>
                  {!session.current && <Button size="sm" variant="ghost" onClick={() => revoke.mutate(session.id)}>Sign out</Button>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
