import {
  AlertTriangle, ArrowDownCircle, CheckCircle2, CircleDashed, CircleDot, Eye, type LucideIcon, PauseCircle, Search, ShieldAlert, XCircle,
} from "lucide-react";

import { cn } from "@/lib/cn";
import type { CheckStatus, IncidentSeverity, IncidentStatus, MonitorStatus } from "@/shared/enums";

import { Badge, type BadgeTone } from "./badge";

/**
 * Status is never colour alone: every state carries an icon and a word, so it
 * reads the same for colour-blind users, in greyscale, and to screen readers.
 */
type Meta = { label: string; tone: BadgeTone; icon: LucideIcon; dot: string };

export const MONITOR_STATUS: Record<MonitorStatus, Meta> = {
  UP: { label: "Operational", tone: "ok", icon: CheckCircle2, dot: "bg-ok" },
  DEGRADED: { label: "Degraded", tone: "warn", icon: AlertTriangle, dot: "bg-warn" },
  DOWN: { label: "Down", tone: "danger", icon: XCircle, dot: "bg-danger" },
  PAUSED: { label: "Paused", tone: "neutral", icon: PauseCircle, dot: "bg-neutral" },
  PENDING: { label: "Pending", tone: "info", icon: CircleDashed, dot: "bg-info" },
};

export const CHECK_STATUS: Record<CheckStatus, Meta> = {
  UP: { label: "Up", tone: "ok", icon: CheckCircle2, dot: "bg-ok" },
  DEGRADED: { label: "Slow", tone: "warn", icon: AlertTriangle, dot: "bg-warn" },
  DOWN: { label: "Failed", tone: "danger", icon: XCircle, dot: "bg-danger" },
};

export const INCIDENT_STATUS: Record<IncidentStatus, Meta> = {
  INVESTIGATING: { label: "Investigating", tone: "danger", icon: Search, dot: "bg-danger" },
  IDENTIFIED: { label: "Identified", tone: "warn", icon: CircleDot, dot: "bg-warn" },
  MONITORING: { label: "Monitoring", tone: "info", icon: Eye, dot: "bg-info" },
  RESOLVED: { label: "Resolved", tone: "ok", icon: CheckCircle2, dot: "bg-ok" },
};

export const SEVERITY: Record<IncidentSeverity, Meta> = {
  CRITICAL: { label: "Critical", tone: "danger", icon: ShieldAlert, dot: "bg-danger" },
  HIGH: { label: "High", tone: "warn", icon: AlertTriangle, dot: "bg-warn" },
  MEDIUM: { label: "Medium", tone: "info", icon: CircleDot, dot: "bg-info" },
  LOW: { label: "Low", tone: "neutral", icon: ArrowDownCircle, dot: "bg-neutral" },
};

function MetaBadge({ meta, className }: { meta: Meta; className?: string }) {
  const Icon = meta.icon;
  return <Badge tone={meta.tone} className={className}><Icon aria-hidden />{meta.label}</Badge>;
}

export const MonitorStatusBadge = ({ status, className }: { status: MonitorStatus; className?: string }) => <MetaBadge meta={MONITOR_STATUS[status]} className={className} />;
export const CheckStatusBadge = ({ status, className }: { status: CheckStatus; className?: string }) => <MetaBadge meta={CHECK_STATUS[status]} className={className} />;
export const IncidentStatusBadge = ({ status, className }: { status: IncidentStatus; className?: string }) => <MetaBadge meta={INCIDENT_STATUS[status]} className={className} />;
export const SeverityBadge = ({ severity, className }: { severity: IncidentSeverity; className?: string }) => <MetaBadge meta={SEVERITY[severity]} className={className} />;

/** A small status light. `live` adds a slow pulse for states that need attention. */
export function StatusDot({ status, live, className }: { status: MonitorStatus; live?: boolean; className?: string }) {
  const meta = MONITOR_STATUS[status];
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} role="img" aria-label={meta.label}>
      {live && (status === "DOWN" || status === "UP") && <span className={cn("absolute inset-0 rounded-full animate-pulse-ring", meta.dot)} />}
      <span className={cn("relative size-2 rounded-full", meta.dot)} />
    </span>
  );
}

export function SampleBadge({ className }: { className?: string }) {
  return <Badge tone="outline" className={className} title="Generated demo data, not a real measurement">Sample</Badge>;
}
