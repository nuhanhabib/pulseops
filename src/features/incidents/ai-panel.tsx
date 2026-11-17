"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Sparkles } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { RelativeTime } from "@/components/ui/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { orgKey, useOrg } from "@/features/org/org-context";
import { useOrgQuery } from "@/features/shared";
import { api, errorMessage } from "@/lib/api-client";
import type { IncidentAnalysisDto } from "@/shared/types";

const LIKELIHOOD = { high: "danger", medium: "warn", low: "neutral" } as const;

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">{title}</h4>
      <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-text-2 marker:text-faint">{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </div>
  );
}

/**
 * The AI assistant. Advisory by construction: it can generate and display an
 * analysis and hand a draft to the update composer, where a person decides
 * whether to post it. It has no path to changing monitors or incidents.
 */
export function AiPanel({ incidentId, onUseDraft }: { incidentId: string; onUseDraft?: (text: string) => void }) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const key = ["incident", incidentId, "analyses"];
  const analyses = useOrgQuery<IncidentAnalysisDto[]>(key, `/incidents/${incidentId}/analyses`);
  const analyze = useMutation({
    mutationFn: () => api.post<IncidentAnalysisDto>(`${org.api}/incidents/${incidentId}/analyses`),
    onSuccess: () => { toast.success("Analysis ready"); void queryClient.invalidateQueries({ queryKey: orgKey(org.organization.slug, ...key) }); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const latest = analyses.data?.[0];
  const canUse = org.can("ai:use");

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-brand-text" />AI incident assistant</CardTitle>
          <p className="mt-0.5 text-xs text-muted">Suggestions from monitoring data. Hypotheses, not conclusions.</p>
        </div>
        {org.aiEnabled && canUse && <Button size="sm" onClick={() => analyze.mutate()} loading={analyze.isPending}><Sparkles />{latest ? "Re-analyze" : "Analyze"}</Button>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!org.aiEnabled && (
          <div className="rounded-lg border border-dashed border-border-strong p-3.5 text-sm text-text-2">
            <p className="font-medium text-text">Not configured on this instance</p>
            <p className="mt-0.5 text-muted">The assistant is optional and off by default. An administrator can enable it with an API key; nothing else in PulseOps depends on it. <Link href={org.paths.settingsAi} className="text-brand-text underline-offset-4 hover:underline">How it works</Link></p>
          </div>
        )}
        {analyze.isPending && <div className="flex flex-col gap-2" aria-busy="true"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4" /><Skeleton className="h-4 w-5/6" /><p className="text-xs text-muted">Analyzing sanitized monitoring data. This can take up to a minute.</p></div>}
        {analyses.isPending ? <Skeleton className="h-24" /> : latest && !analyze.isPending ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone="brand"><Sparkles />AI-generated</Badge>
              {latest.isSample && <Badge tone="outline" title="A stored example, not produced by a live model">Sample analysis</Badge>}
              <span>{latest.isSample ? "Seeded example" : latest.model} · <RelativeTime date={latest.createdAt} /></span>
            </div>
            <p className="text-sm text-text">{latest.content.summary}</p>
            {latest.content.possibleCauses.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">Possible causes</h4>
                <ul className="flex flex-col gap-2.5">
                  {latest.content.possibleCauses.map((cause, index) => (
                    <li key={index} className="rounded-lg border border-border bg-surface-2 p-3">
                      <div className="flex items-start justify-between gap-2"><span className="flex gap-2 text-sm font-medium text-text"><Lightbulb className="mt-0.5 size-3.5 shrink-0 text-muted" />{cause.cause}</span><Badge tone={LIKELIHOOD[cause.likelihood]}>{cause.likelihood} likelihood</Badge></div>
                      <p className="mt-1 pl-5.5 text-xs text-muted">{cause.reasoning}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Section title="Supporting evidence" items={latest.content.supportingEvidence} />
            <Section title="Troubleshooting steps" items={latest.content.troubleshootingSteps} />
            <Section title="Recommended next actions" items={latest.content.recommendedActions} />
            {latest.content.draftUpdate && (
              <div>
                <h4 className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">Draft update</h4>
                <blockquote className="rounded-lg border-l-2 border-brand bg-brand-soft px-3 py-2 text-sm text-text-2">{latest.content.draftUpdate}</blockquote>
                <div className="mt-2 flex gap-2">
                  {onUseDraft && org.can("incident:write") && <Button size="sm" onClick={() => onUseDraft(latest.content.draftUpdate)}>Use as draft</Button>}
                  <CopyButton size="sm" variant="ghost" value={latest.content.draftUpdate} />
                </div>
                <p className="mt-1.5 text-xs text-muted">Nothing is posted until you review and send it.</p>
              </div>
            )}
            <Section title="What this cannot tell you" items={latest.content.caveats} />
          </>
        ) : !analyze.isPending && org.aiEnabled ? <p className="text-sm text-muted">No analysis yet. {canUse ? "Run one to get a summary, ranked hypotheses, and a draft update." : "Your role cannot request one."}</p> : null}
      </CardContent>
    </Card>
  );
}
