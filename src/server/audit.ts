import { AuditActorType } from "@/shared/enums";

import { type DbClient, type Prisma } from "./db";
import type { OrgContext } from "./tenancy";

/**
 * Audit trail: who did what, to what, from where.
 *
 * Written through the same transaction client as the change it describes, so
 * an action and its audit record commit or roll back together. Metadata is
 * sanitized on the way in; nothing that looks like a credential is stored.
 */

export interface AuditEntry {
  /** Dotted verb, e.g. "monitor.created". The full vocabulary is in `AUDIT_ACTIONS`. */
  action: AuditAction;
  target?: { type: string; id: string; label?: string | null };
  metadata?: Record<string, unknown>;
}

export const AUDIT_ACTIONS = [
  "organization.created",
  "organization.updated",
  "organization.deleted",
  "member.invited",
  "member.invitation_revoked",
  "member.joined",
  "member.role_changed",
  "member.removed",
  "member.left",
  "monitor.created",
  "monitor.updated",
  "monitor.paused",
  "monitor.resumed",
  "monitor.deleted",
  "incident.created",
  "incident.updated",
  "incident.status_changed",
  "incident.resolved",
  "incident.reopened",
  "incident.assigned",
  "incident.monitors_changed",
  "incident.note_added",
  "incident.deleted",
  "incident.analysis_requested",
  "status_page.created",
  "status_page.updated",
  "status_page.published",
  "status_page.unpublished",
  "status_page.deleted",
  "notification_channel.created",
  "notification_channel.updated",
  "notification_channel.secret_rotated",
  "notification_channel.deleted",
  "notification_preferences.updated",
  "account.password_changed",
  "account.sessions_revoked",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|credential/i;
const MAX_STRING = 500;
const MAX_DEPTH = 4;

/** Drops credential-like keys, truncates long strings, and bounds depth. */
export function sanitizeMetadata(value: unknown, depth = 0): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeMetadata(item, depth + 1));
  }
  if (typeof value === "object") {
    const output: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      output[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizeMetadata(entry, depth + 1);
    }
    return output;
  }
  return String(value);
}

/**
 * Records which fields changed, as `{ field: { from, to } }`. Only the listed
 * fields are compared, so a call site cannot leak a column by forgetting it
 * exists.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: (keyof T & string)[],
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    if (!(field in after)) continue;
    const from = before[field];
    const to = after[field];
    if (to === undefined) continue;
    const same = from instanceof Date && to instanceof Date ? from.getTime() === to.getTime() : from === to;
    if (!same) changes[field] = { from: from ?? null, to: to ?? null };
  }
  return changes;
}

export async function recordAudit(db: DbClient, ctx: OrgContext, entry: AuditEntry): Promise<void> {
  const metadata = entry.metadata ? sanitizeMetadata(entry.metadata) : null;
  await db.auditLog.create({
    data: {
      organizationId: ctx.organization.id,
      actorType: AuditActorType.USER,
      actorId: ctx.actor.userId,
      actorLabel: ctx.actor.email,
      action: entry.action,
      targetType: entry.target?.type ?? null,
      targetId: entry.target?.id ?? null,
      targetLabel: entry.target?.label ?? null,
      metadata: metadata === null ? undefined : metadata,
      ipAddress: ctx.meta.ipAddress ?? null,
      userAgent: ctx.meta.userAgent?.slice(0, 400) ?? null,
    },
  });
}

/** For changes made by the platform itself (automation, the worker). */
export async function recordSystemAudit(db: DbClient, organizationId: string, entry: AuditEntry): Promise<void> {
  const metadata = entry.metadata ? sanitizeMetadata(entry.metadata) : null;
  await db.auditLog.create({
    data: {
      organizationId,
      actorType: AuditActorType.SYSTEM,
      actorLabel: "PulseOps automation",
      action: entry.action,
      targetType: entry.target?.type ?? null,
      targetId: entry.target?.id ?? null,
      targetLabel: entry.target?.label ?? null,
      metadata: metadata === null ? undefined : metadata,
    },
  });
}
