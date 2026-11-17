"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/states";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { ROLE_LABELS } from "@/shared/permissions";
import { routes, safeRedirectPath } from "@/shared/routes";
import { estimatePasswordStrength, type LoginInput, loginSchema, type RegisterInput, registerSchema } from "@/shared/schemas/auth";
import { organizationNameSchema } from "@/shared/schemas/auth";
import type { InvitationPreviewDto } from "@/shared/types";

interface AuthResponse { orgSlug: string | null }

/** After authenticating, go where the user was headed, but only ever to a path on this site. */
function destination(next: string | null, orgSlug: string | null): string {
  return safeRedirectPath(next, orgSlug ? routes.org(orgSlug).dashboard : routes.app);
}

function applyFieldErrors<T extends Record<string, unknown>>(error: unknown, setError: (field: keyof T & string, error: { message: string }) => void): boolean {
  if (!(error instanceof ApiError) || Object.keys(error.fields).length === 0) return false;
  for (const [field, messages] of Object.entries(error.fields)) setError(field as keyof T & string, { message: messages[0] ?? "Invalid value." });
  return true;
}

export function SignInForm({ demo }: { demo: boolean }) {
  const params = useSearchParams();
  const next = params.get("next");
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const login = useMutation({
    mutationFn: (input: LoginInput) => api.post<AuthResponse>("/api/v1/auth/login", input),
    // A full navigation so the server renders the workspace with the new session.
    onSuccess: (result) => window.location.assign(destination(next, result.orgSlug)),
  });
  return (
    <form onSubmit={handleSubmit((values) => login.mutate(values))} noValidate className="flex flex-col gap-4">
      {login.error && <Callout tone="danger"><span role="alert">{errorMessage(login.error)}</span></Callout>}
      <Field label="Email" error={errors.email?.message}><Input type="email" autoComplete="email" autoFocus {...register("email")} /></Field>
      <Field label="Password" error={errors.password?.message}><Input type="password" autoComplete="current-password" {...register("password")} /></Field>
      <Button type="submit" variant="primary" size="lg" loading={login.isPending || login.isSuccess}>Sign in</Button>
      {demo && (
        <button type="button" onClick={() => { setValue("email", "demo@northwind.example"); setValue("password", "pulseops-demo-2026"); }}
          className="flex items-center gap-2.5 rounded-lg border border-dashed border-border-strong px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-2">
          <FlaskConical className="size-4 shrink-0 text-brand-text" />
          <span><span className="block font-medium text-text">Use the demo workspace</span><span className="block text-xs text-muted">Fills in the seeded demo account. Sample data, clearly labelled.</span></span>
        </button>
      )}
      <p className="text-center text-sm text-muted">New to PulseOps? <Link href={next ? `${routes.signUp}?next=${encodeURIComponent(next)}` : routes.signUp} className="font-medium text-brand-text hover:underline">Create an account</Link></p>
    </form>
  );
}

function StrengthMeter({ password }: { password: string }) {
  const { score, label } = estimatePasswordStrength(password);
  if (!password) return null;
  const colors = ["bg-danger", "bg-danger", "bg-warn", "bg-ok", "bg-ok"];
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden>{[1, 2, 3, 4].map((step) => <span key={step} className={cn("h-1 flex-1 rounded-full", step <= score ? colors[score] : "bg-surface-3")} />)}</div>
      <span className="w-16 text-right text-xs text-muted">{label}</span>
    </div>
  );
}

export function SignUpForm({ invitation, token }: { invitation?: InvitationPreviewDto; token?: string }) {
  const params = useSearchParams();
  const next = params.get("next");
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    // When joining by invitation no workspace is created; the placeholder satisfies the shared schema.
    defaultValues: { name: "", email: invitation?.email ?? "", password: "", organizationName: invitation ? invitation.organizationName : "", invitationToken: token },
  });
  const password = useWatch({ control, name: "password" });
  const signUp = useMutation({
    mutationFn: (input: RegisterInput) => api.post<AuthResponse>("/api/v1/auth/register", input),
    onSuccess: (result) => window.location.assign(destination(next, result.orgSlug)),
    onError: (error) => void applyFieldErrors<RegisterInput>(error, setError),
  });
  const generalError = signUp.error && !(signUp.error instanceof ApiError && Object.keys(signUp.error.fields).length) ? errorMessage(signUp.error) : null;
  return (
    <form onSubmit={handleSubmit((values) => signUp.mutate(values))} noValidate className="flex flex-col gap-4">
      {generalError && <Callout tone="danger"><span role="alert">{generalError}</span></Callout>}
      <Field label="Your name" error={errors.name?.message}><Input autoComplete="name" autoFocus {...register("name")} /></Field>
      <Field label="Work email" error={errors.email?.message}><Input type="email" autoComplete="email" readOnly={Boolean(invitation)} {...register("email")} /></Field>
      <Field label="Password" hint="At least 10 characters, mixing letters with a number or symbol." error={errors.password?.message}><Input type="password" autoComplete="new-password" {...register("password")} /></Field>
      <StrengthMeter password={password ?? ""} />
      {!invitation && <Field label="Organization name" hint="Your team's workspace. You can invite people after." error={errors.organizationName?.message}><Input autoComplete="organization" placeholder="Acme Inc." {...register("organizationName")} /></Field>}
      <Button type="submit" variant="primary" size="lg" loading={signUp.isPending || signUp.isSuccess}>{invitation ? `Join ${invitation.organizationName}` : "Create account"}</Button>
      <p className="text-center text-sm text-muted">Already have an account? <Link href={routes.signIn} className="font-medium text-brand-text hover:underline">Sign in</Link></p>
    </form>
  );
}

export function InvitationPanel({ token, signedInEmail }: { token: string; signedInEmail: string | null }) {
  const invitation = useQuery({ queryKey: ["invitation", token], queryFn: () => api.get<InvitationPreviewDto>(`/api/v1/invitations/${token}`), retry: false });
  const accept = useMutation({
    mutationFn: () => api.post<{ orgSlug: string }>(`/api/v1/invitations/${token}`),
    onSuccess: (result) => window.location.assign(routes.org(result.orgSlug).dashboard),
  });
  if (invitation.isPending) return <div className="flex flex-col gap-3" aria-busy="true"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>;
  if (invitation.isError) {
    return (
      <div className="text-center">
        <h1 className="text-xl font-semibold">This invitation is not valid</h1>
        <p className="mt-2 text-sm text-muted">It may have expired, been revoked, or already been used. Ask whoever invited you to send a new one.</p>
        <Button asChild className="mt-6"><Link href={routes.signIn}>Go to sign in</Link></Button>
      </div>
    );
  }
  const data = invitation.data;
  const here = routes.invite(token);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Join {data.organizationName}</h1>
        <p className="mt-1.5 text-sm text-muted">{data.inviterName ?? "A teammate"} invited <span className="font-medium text-text-2">{data.email}</span> as {ROLE_LABELS[data.role] === "Admin" ? "an" : "a"} {ROLE_LABELS[data.role].toLowerCase()}.</p>
      </div>
      {signedInEmail === data.email ? (
        <>
          {accept.error && <Callout tone="danger"><span role="alert">{errorMessage(accept.error)}</span></Callout>}
          <Button variant="primary" size="lg" loading={accept.isPending || accept.isSuccess} onClick={() => accept.mutate()}>Accept invitation</Button>
        </>
      ) : signedInEmail ? (
        <Callout tone="warn" title="You are signed in as someone else">This invitation is for {data.email}, but you are signed in as {signedInEmail}. Sign out, then open this link again.</Callout>
      ) : data.accountExists ? (
        <Button asChild variant="primary" size="lg"><Link href={`${routes.signIn}?next=${encodeURIComponent(here)}`}>Sign in to accept</Link></Button>
      ) : (
        <SignUpForm invitation={data} token={token} />
      )}
    </div>
  );
}

export function NewOrganizationForm() {
  const { register, handleSubmit, setError, formState: { errors } } = useForm<{ name: string }>({ defaultValues: { name: "" } });
  const create = useMutation({
    mutationFn: (input: { name: string }) => api.post<{ slug: string }>("/api/v1/orgs", input),
    onSuccess: (org) => window.location.assign(routes.org(org.slug).dashboard),
    onError: (error) => { if (!applyFieldErrors<{ name: string }>(error, setError)) setError("name", { message: errorMessage(error) }); },
  });
  const validate = (value: string) => { const result = organizationNameSchema.safeParse(value); return result.success || (result.error.issues[0]?.message ?? "Invalid name."); };
  return (
    <form onSubmit={handleSubmit((values) => create.mutate(values))} noValidate className="flex flex-col gap-4">
      <Field label="Organization name" hint="A separate workspace with its own monitors, incidents, and members." error={errors.name?.message}><Input autoFocus placeholder="Acme Inc." {...register("name", { validate })} /></Field>
      <Button type="submit" variant="primary" size="lg" loading={create.isPending || create.isSuccess}>Create organization</Button>
      <Button asChild variant="ghost"><Link href={routes.app}>Cancel</Link></Button>
    </form>
  );
}
