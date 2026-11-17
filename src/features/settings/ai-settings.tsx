"use client";

import { CheckCircle2, CircleOff, ShieldCheck, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgQuery } from "@/features/shared";
import type { AiStatusDto } from "@/shared/types";

const SENT = ["Incident severity, status, and age", "Per-monitor check counts, failure counts, and response times for two hourly windows", "The most frequent error categories, with URLs, IP addresses, emails, and tokens removed", "The incident timeline, sanitized the same way"];
const NEVER = ["Monitor URLs, hostnames, or names", "Internal notes", "Member names and email addresses", "Request or response bodies, headers, or any credential"];

export function AiSettings() {
  const status = useOrgQuery<AiStatusDto>(["ai", "status"], "/ai");
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-brand-text" />AI incident assistant</CardTitle><p className="mt-0.5 text-sm text-muted">Optional. Summarizes an incident, ranks possible causes, and drafts an update for a person to review.</p></div>
          {status.data ? <Badge tone={status.data.enabled ? "ok" : "neutral"}>{status.data.enabled ? <><CheckCircle2 />Enabled</> : <><CircleOff />Not configured</>}</Badge> : <Skeleton className="h-5 w-24" />}
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-text-2">
          {status.data?.enabled ? (
            <dl className="grid gap-3 sm:grid-cols-3">
              <div><dt className="text-xs text-muted">Provider</dt><dd className="font-medium text-text capitalize">{status.data.provider}</dd></div>
              <div><dt className="text-xs text-muted">Model</dt><dd className="font-mono text-xs text-text">{status.data.model}</dd></div>
              <div><dt className="text-xs text-muted">Limit</dt><dd className="font-medium text-text">{status.data.hourlyLimit} analyses per hour</dd></div>
            </dl>
          ) : (
            <div className="rounded-lg border border-dashed border-border-strong p-4">
              <p className="font-medium text-text">To enable it, an operator sets two environment variables and restarts the web app:</p>
              <pre className="mt-2 overflow-x-auto rounded-md bg-surface-2 p-3 font-mono text-xs text-text">AI_PROVIDER=anthropic{"\n"}ANTHROPIC_API_KEY=…</pre>
              <p className="mt-2 text-muted">The key lives in the server environment only. It is never stored in the database, shown in this UI, or sent to the browser. Every other feature works without it.</p>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-6 md:grid-cols-2">
        <Card><CardHeader><CardTitle>What is sent to the provider</CardTitle></CardHeader><CardContent><ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm text-text-2">{SENT.map((item) => <li key={item}>{item}</li>)}</ul></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-ok-fg" />What is never sent</CardTitle></CardHeader><CardContent><ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm text-text-2">{NEVER.map((item) => <li key={item}>{item}</li>)}</ul></CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>Guardrails</CardTitle></CardHeader><CardContent><ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm text-text-2">
        <li>Analyses are labelled as AI-generated and framed as hypotheses. External checks cannot prove a root cause.</li>
        <li>The assistant cannot change monitors, incidents, or status pages. A draft update is only posted if a person sends it.</li>
        <li>Requests are rate limited per organization and capped in output tokens; each one is recorded in the audit log.</li>
      </ul></CardContent></Card>
    </div>
  );
}
