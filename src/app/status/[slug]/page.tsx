import { AlertTriangle, CheckCircle2, CircleDashed, FlaskConical, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { UptimeBars } from "@/components/charts/figures";
import { LogoMark } from "@/components/ui/logo";
import { INCIDENT_STATUS } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { getPublicStatusPage } from "@/server/modules/status-pages/service";
import { APP_NAME } from "@/shared/constants";
import { formatDateTime, formatDurationWords } from "@/shared/format";
import type { PublicComponentStatus, PublicIncidentDto, PublicOverallStatus } from "@/shared/types";
import { formatUptime } from "@/shared/uptime";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getPublicStatusPage((await params).slug);
  if (!page) return { title: "Status page not found", robots: { index: false } };
  return { title: page.name, description: page.description ?? `Current status and incident history for ${page.name}.` };
}

const OVERALL: Record<PublicOverallStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  operational: { label: "All systems operational", icon: CheckCircle2, className: "border-ok/30 bg-ok-soft text-ok-fg" },
  degraded: { label: "Some systems are degraded", icon: AlertTriangle, className: "border-warn/30 bg-warn-soft text-warn-fg" },
  partial_outage: { label: "Partial outage", icon: XCircle, className: "border-danger/30 bg-danger-soft text-danger-fg" },
  major_outage: { label: "Major outage", icon: XCircle, className: "border-danger/30 bg-danger-soft text-danger-fg" },
  unknown: { label: "Status is being determined", icon: CircleDashed, className: "border-border bg-surface-2 text-muted" },
};

const COMPONENT: Record<PublicComponentStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  operational: { label: "Operational", icon: CheckCircle2, className: "text-ok-fg" },
  degraded: { label: "Degraded", icon: AlertTriangle, className: "text-warn-fg" },
  outage: { label: "Outage", icon: XCircle, className: "text-danger-fg" },
  unknown: { label: "No data", icon: CircleDashed, className: "text-muted" },
};

function Incident({ incident }: { incident: PublicIncidentDto }) {
  const status = INCIDENT_STATUS[incident.status];
  return (
    <article className="surface-card p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold">{incident.title}</h3>
        <span className="inline-flex items-center gap-1.5 text-sm text-text-2"><status.icon className="size-4" aria-hidden />{status.label}</span>
      </header>
      <p className="mt-1 text-xs text-muted">
        {formatDateTime(incident.startedAt)}
        {incident.resolvedAt && ` · resolved after ${formatDurationWords((new Date(incident.resolvedAt).getTime() - new Date(incident.startedAt).getTime()) / 1000)}`}
        {incident.components.length > 0 && ` · affects ${incident.components.join(", ")}`}
      </p>
      {incident.updates.length > 0 && (
        <ol className="mt-4 flex flex-col gap-3 border-l border-border pl-4">
          {incident.updates.map((update) => (
            <li key={update.id}>
              <p className="text-xs text-muted">{update.status && <span className="font-medium text-text-2">{INCIDENT_STATUS[update.status].label} · </span>}{formatDateTime(update.createdAt)}</p>
              <p className="mt-0.5 text-sm whitespace-pre-wrap text-text-2">{update.message}</p>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

/**
 * The public page. Rendered on the server from `getPublicStatusPage`, which is
 * the only query that feeds it and selects only publishable fields.
 */
async function StatusContent({ params }: Props) {
  const { slug } = await params;
  const page = await getPublicStatusPage(slug);
  if (!page) notFound();
  const overall = OVERALL[page.overall];

  return (
    <div className={cn("min-h-dvh bg-bg text-text", page.theme === "DARK" && "dark", page.theme === "LIGHT" && "light")} style={{ ["--brand" as string]: page.accentColor }}>
      <div className="h-1" style={{ background: page.accentColor }} />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{page.name}</h1>
          {page.description && <p className="mt-2 text-base text-text-2">{page.description}</p>}
        </header>

        <div role="status" className={cn("mt-8 flex items-center gap-3 rounded-xl border px-5 py-4", overall.className)}>
          <overall.icon className="size-6 shrink-0" aria-hidden />
          <p className="text-md font-semibold">{overall.label}</p>
        </div>

        {page.containsSampleData && (
          <p className="mt-3 flex items-start gap-2 text-xs text-muted"><FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />This is a demo page. Its history includes generated sample data.</p>
        )}

        {page.activeIncidents.length > 0 && (
          <section className="mt-10" aria-labelledby="active-incidents">
            <h2 id="active-incidents" className="mb-3 text-md font-semibold">Active incidents</h2>
            <div className="flex flex-col gap-3">{page.activeIncidents.map((incident) => <Incident key={incident.id} incident={incident} />)}</div>
          </section>
        )}

        <section className="mt-10" aria-labelledby="components">
          <div className="mb-3 flex items-baseline justify-between"><h2 id="components" className="text-md font-semibold">Components</h2><span className="text-xs text-muted">Uptime, last {page.uptimeDays} days</span></div>
          {page.components.length === 0 ? <p className="surface-card p-5 text-sm text-muted">No components are listed on this page yet.</p> : (
            <ul className="surface-card divide-y divide-border">
              {page.components.map((component) => {
                const status = COMPONENT[component.status];
                return (
                  <li key={component.name} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><h3 className="text-base font-semibold">{component.name}</h3>{component.description && <p className="text-sm text-muted">{component.description}</p>}</div>
                      <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-sm font-medium", status.className)}><status.icon className="size-4" aria-hidden />{status.label}</span>
                    </div>
                    <UptimeBars days={component.days} className="mt-3" height={28} />
                    <div className="mt-1.5 flex justify-between text-2xs text-muted"><span>{page.uptimeDays} days ago</span><span className="font-medium text-text-2">{formatUptime(component.uptime)} uptime</span><span>Today</span></div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {page.pastIncidents.length > 0 && (
          <section className="mt-10" aria-labelledby="past-incidents">
            <h2 id="past-incidents" className="mb-3 text-md font-semibold">Past incidents</h2>
            <div className="flex flex-col gap-3">{page.pastIncidents.map((incident) => <Incident key={incident.id} incident={incident} />)}</div>
          </section>
        )}

        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-xs text-muted">
          <span>Updated {new Date(page.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC{page.supportUrl && <> · <a href={page.supportUrl} rel="noreferrer noopener" className="underline underline-offset-4 hover:text-text">Contact support</a></>}</span>
          <Link href="/" className="inline-flex items-center gap-1.5 hover:text-text"><LogoMark className="size-4" />Powered by {APP_NAME}</Link>
        </footer>
      </main>
    </div>
  );
}

export default function StatusPage({ params }: Props) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-4 py-14" aria-busy="true"><div className="skeleton h-9 w-64" /><div className="skeleton mt-8 h-16" /><div className="skeleton mt-10 h-72" /></div>}>
      <StatusContent params={params} />
    </Suspense>
  );
}
