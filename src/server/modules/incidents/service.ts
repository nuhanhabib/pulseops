import { formatDurationWords } from "@/shared/format";
import {
  ActivityLevel, ActivityType, IncidentSeverity, IncidentSource, IncidentStatus, IncidentUpdateKind, NotificationEvent,
} from "@/shared/enums";
import type { RealtimeEvent } from "@/shared/realtime";
import { routes } from "@/shared/routes";
import type {
  CreateIncidentInput, CreateIncidentNoteInput, CreateIncidentUpdateInput, ListIncidentsQuery, UpdateIncidentInput,
} from "@/shared/schemas/incident";
import type { AuditLogDto, IncidentDetailDto, IncidentListItemDto, Paginated, TimelineEntryDto } from "@/shared/types";

import { diffFields, recordAudit } from "../../audit";
import { type DbClient, type Prisma, prisma } from "../../db";
import { fieldError, notFound } from "../../errors";
import { publish } from "../../realtime/publisher";
import { authorize, type OrgContext } from "../../tenancy";
import { recordActivity } from "../activity/record";
import { iso, isoOrNull, toUserRef, userRefSelect } from "../mappers";
import { enqueueNotifications } from "../notifications/outbox";
import { nextIncidentNumber } from "./automation";

const listInclude = {
  assignee: { select: userRefSelect },
  monitors: { select: { monitor: { select: { id: true, name: true, status: true } } }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.IncidentInclude;

type IncidentRow = Prisma.IncidentGetPayload<{ include: typeof listInclude }>;

function toListItem(row: IncidentRow): IncidentListItemDto {
  return {
    id: row.id, number: row.number, title: row.title, status: row.status, severity: row.severity, source: row.source,
    isPublic: row.isPublic, isSample: row.isSample, startedAt: iso(row.startedAt), acknowledgedAt: isoOrNull(row.acknowledgedAt),
    resolvedAt: isoOrNull(row.resolvedAt), updatedAt: iso(row.updatedAt), assignee: toUserRef(row.assignee),
    monitors: row.monitors.map((link) => link.monitor),
  };
}

async function findIncident(db: DbClient, ctx: OrgContext, incidentId: string) {
  const incident = await db.incident.findFirst({ where: { id: incidentId, organizationId: ctx.organization.id }, include: listInclude });
  if (!incident) throw notFound("Incident");
  return incident;
}

/** Every id must belong to this organization. Foreign ids are reported as invalid, not as "forbidden". */
async function assertMonitorsInOrg(db: DbClient, ctx: OrgContext, monitorIds: string[]): Promise<void> {
  if (monitorIds.length === 0) return;
  const found = await db.monitor.count({ where: { organizationId: ctx.organization.id, id: { in: monitorIds } } });
  if (found !== new Set(monitorIds).size) throw fieldError("monitorIds", "One or more monitors could not be found.");
}

async function assertAssignable(db: DbClient, ctx: OrgContext, userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const member = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: ctx.organization.id, userId } }, select: { id: true },
  });
  if (!member) throw fieldError("assigneeId", "Incidents can only be assigned to members of this organization.");
}


export async function listIncidents(ctx: OrgContext, query: ListIncidentsQuery): Promise<Paginated<IncidentListItemDto>> {
  authorize(ctx, "incident:read");
  const numberQuery = query.q ? /^(?:inc-?)?(\d{1,9})$/i.exec(query.q) : null;
  const where: Prisma.IncidentWhereInput = {
    organizationId: ctx.organization.id,
    ...(query.state === "open" ? { status: { not: IncidentStatus.RESOLVED } } : {}),
    ...(query.state === "resolved" ? { status: IncidentStatus.RESOLVED } : {}),
    ...(query.status?.length ? { status: { in: query.status } } : {}),
    ...(query.severity?.length ? { severity: { in: query.severity } } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.monitorId ? { monitors: { some: { monitorId: query.monitorId } } } : {}),
    ...(query.assigneeId === "me" ? { assigneeId: ctx.actor.userId }
      : query.assigneeId === "unassigned" ? { assigneeId: null }
      : query.assigneeId ? { assigneeId: query.assigneeId } : {}),
    ...(query.q
      ? { OR: [{ title: { contains: query.q, mode: "insensitive" } }, ...(numberQuery ? [{ number: Number(numberQuery[1]) }] : [])] }
      : {}),
  };

  const total = await prisma.incident.count({ where });
  let rows: IncidentRow[];
  if (query.sort === "severity" || query.sort === "status") {
    // Enum columns sort by declaration order in Postgres, which matches CRITICAL→LOW and INVESTIGATING→RESOLVED.
    rows = await prisma.incident.findMany({
      where, include: listInclude,
      orderBy: [{ [query.sort]: query.direction === "desc" ? "asc" : "desc" }, { startedAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize, take: query.pageSize,
    });
  } else {
    rows = await prisma.incident.findMany({
      where, include: listInclude,
      orderBy: [{ [query.sort]: query.direction }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize, take: query.pageSize,
    });
  }
  return { items: rows.map(toListItem), page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
}

export async function getIncident(ctx: OrgContext, incidentId: string): Promise<IncidentDetailDto> {
  authorize(ctx, "incident:read");
  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, organizationId: ctx.organization.id },
    include: {
      ...listInclude,
      createdBy: { select: userRefSelect },
      updates: { orderBy: { createdAt: "asc" }, include: { author: { select: userRefSelect } } },
      notes: { orderBy: { createdAt: "asc" }, include: { author: { select: userRefSelect } } },
    },
  });
  if (!incident) throw notFound("Incident");

  const timeline: TimelineEntryDto[] = [
    ...incident.updates.map((update) => ({
      type: "update" as const, id: update.id, kind: update.kind, status: update.status, message: update.message,
      isPublic: update.isPublic, author: toUserRef(update.author), createdAt: iso(update.createdAt),
    })),
    ...incident.notes.map((note) => ({
      type: "note" as const, id: note.id, body: note.body, author: toUserRef(note.author), createdAt: iso(note.createdAt),
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return { ...toListItem(incident), summary: incident.summary, createdBy: toUserRef(incident.createdBy), timeline };
}

function incidentPayload(ctx: OrgContext, incident: { id: string; number: number; title: string; severity: IncidentSeverity; status: IncidentStatus }, headline: string, facts: { label: string; value: string }[], at: Date) {
  return {
    headline, facts, path: routes.org(ctx.organization.slug).incident(incident.id),
    organization: { name: ctx.organization.name, slug: ctx.organization.slug },
    incident: { id: incident.id, number: incident.number, title: incident.title, severity: incident.severity, status: incident.status },
    occurredAt: at.toISOString(),
  };
}

export async function createIncident(ctx: OrgContext, input: CreateIncidentInput): Promise<IncidentDetailDto> {
  authorize(ctx, "incident:write");
  const now = new Date();
  const resolved = input.status === IncidentStatus.RESOLVED;

  const incident = await prisma.$transaction(async (tx) => {
    await assertMonitorsInOrg(tx, ctx, input.monitorIds);
    await assertAssignable(tx, ctx, input.assigneeId);
    const number = await nextIncidentNumber(tx, ctx.organization.id);
    const created = await tx.incident.create({
      data: {
        organizationId: ctx.organization.id, number, title: input.title, summary: input.summary, status: input.status,
        severity: input.severity, source: IncidentSource.MANUAL, isPublic: input.isPublic, assigneeId: input.assigneeId,
        createdById: ctx.actor.userId, startedAt: now, acknowledgedAt: now, resolvedAt: resolved ? now : null,
        monitors: { create: [...new Set(input.monitorIds)].map((monitorId) => ({ monitorId, organizationId: ctx.organization.id })) },
        updates: {
          create: {
            organizationId: ctx.organization.id, kind: IncidentUpdateKind.SYSTEM, status: input.status,
            message: `Incident opened by ${ctx.actor.name}.`, authorId: ctx.actor.userId, createdAt: now,
          },
        },
      },
      select: { id: true, number: true, title: true, severity: true, status: true },
    });
    await recordAudit(tx, ctx, {
      action: "incident.created", target: { type: "incident", id: created.id, label: `INC-${number}` },
      metadata: { title: input.title, severity: input.severity, monitorIds: input.monitorIds },
    });
    await recordActivity(tx, {
      organizationId: ctx.organization.id, type: ActivityType.INCIDENT_OPENED,
      level: input.severity === IncidentSeverity.CRITICAL || input.severity === IncidentSeverity.HIGH ? ActivityLevel.CRITICAL : ActivityLevel.WARNING,
      title: `INC-${number} opened: ${input.title}`, description: `Opened by ${ctx.actor.name}.`, incidentId: created.id, occurredAt: now,
    });
    await enqueueNotifications(tx, {
      organizationId: ctx.organization.id, event: NotificationEvent.INCIDENT_CREATED, occurrenceKey: `incident.created:${created.id}`,
      subject: `[${created.severity}] INC-${number}: ${created.title}`, incidentId: created.id,
      payload: incidentPayload(ctx, created, `Incident INC-${number} opened`, [
        { label: "Incident", value: created.title }, { label: "Severity", value: created.severity }, { label: "Opened by", value: ctx.actor.name },
      ], now),
    });
    return created;
  });

  await publish(ctx.organization.id,
    { type: "incident.created", incidentId: incident.id, number: incident.number, title: incident.title, severity: incident.severity, automated: false },
    { type: "activity.created" });
  return getIncident(ctx, incident.id);
}

export async function updateIncident(ctx: OrgContext, incidentId: string, input: UpdateIncidentInput): Promise<IncidentDetailDto> {
  authorize(ctx, "incident:write");
  await prisma.$transaction(async (tx) => {
    const before = await findIncident(tx, ctx, incidentId);
    if (input.assigneeId !== undefined) await assertAssignable(tx, ctx, input.assigneeId);
    const changes = diffFields(before, input, ["title", "summary", "severity", "assigneeId", "isPublic"]);
    if (Object.keys(changes).length === 0) return;

    await tx.incident.update({
      where: { id: before.id },
      data: { ...input, ...(before.acknowledgedAt ? {} : { acknowledgedAt: new Date() }) },
    });

    const notes: string[] = [];
    if (changes.severity) notes.push(`Severity changed from ${String(changes.severity.from).toLowerCase()} to ${String(changes.severity.to).toLowerCase()}.`);
    if (changes.assigneeId) {
      const assignee = input.assigneeId ? await tx.user.findUnique({ where: { id: input.assigneeId }, select: { name: true } }) : null;
      notes.push(assignee ? `Assigned to ${assignee.name}.` : "Unassigned.");
    }
    if (changes.isPublic) notes.push(input.isPublic ? "Made visible on status pages." : "Hidden from status pages.");
    if (changes.title) notes.push("Title updated.");
    if (notes.length > 0) {
      await tx.incidentUpdate.create({
        data: { incidentId: before.id, organizationId: ctx.organization.id, kind: IncidentUpdateKind.SYSTEM, message: `${ctx.actor.name}: ${notes.join(" ")}`, authorId: ctx.actor.userId },
      });
    }
    await recordAudit(tx, ctx, {
      action: changes.assigneeId && Object.keys(changes).length === 1 ? "incident.assigned" : "incident.updated",
      target: { type: "incident", id: before.id, label: `INC-${before.number}` }, metadata: { changes },
    });
  });
  const detail = await getIncident(ctx, incidentId);
  await publish(ctx.organization.id, { type: "incident.updated", incidentId, number: detail.number }, { type: "statuspage.changed" });
  return detail;
}

/**
 * Posts a timeline update and, optionally, moves the incident to a new status.
 * Resolving and reopening both go through here, so there is exactly one place
 * where `resolvedAt` is set or cleared.
 */
export async function addIncidentUpdate(ctx: OrgContext, incidentId: string, input: CreateIncidentUpdateInput): Promise<IncidentDetailDto> {
  authorize(ctx, "incident:write");
  const now = new Date();
  const events: RealtimeEvent[] = [];

  await prisma.$transaction(async (tx) => {
    const before = await findIncident(tx, ctx, incidentId);
    const nextStatus = input.status ?? before.status;
    const statusChanged = nextStatus !== before.status;
    const resolving = statusChanged && nextStatus === IncidentStatus.RESOLVED;
    const reopening = statusChanged && before.status === IncidentStatus.RESOLVED;

    await tx.incidentUpdate.create({
      data: {
        incidentId: before.id, organizationId: ctx.organization.id, kind: IncidentUpdateKind.UPDATE,
        status: statusChanged ? nextStatus : null, message: input.message,
        // An update can only be public if the incident itself is.
        isPublic: input.isPublic && before.isPublic, authorId: ctx.actor.userId, createdAt: now,
      },
    });
    await tx.incident.update({
      where: { id: before.id },
      data: {
        status: nextStatus,
        ...(before.acknowledgedAt ? {} : { acknowledgedAt: now }),
        ...(resolving ? { resolvedAt: now } : {}),
        ...(reopening ? { resolvedAt: null } : {}),
        updatedAt: now,
      },
    });

    if (statusChanged) {
      await recordAudit(tx, ctx, {
        action: resolving ? "incident.resolved" : reopening ? "incident.reopened" : "incident.status_changed",
        target: { type: "incident", id: before.id, label: `INC-${before.number}` }, metadata: { from: before.status, to: nextStatus },
      });
    }
    if (resolving) {
      await recordActivity(tx, {
        organizationId: ctx.organization.id, type: ActivityType.INCIDENT_RESOLVED, level: ActivityLevel.SUCCESS,
        title: `INC-${before.number} resolved: ${before.title}`, description: `Resolved by ${ctx.actor.name}.`, incidentId: before.id, occurredAt: now,
      });
      await enqueueNotifications(tx, {
        organizationId: ctx.organization.id, event: NotificationEvent.INCIDENT_RESOLVED,
        occurrenceKey: `incident.resolved:${before.id}:${now.getTime()}`, subject: `[Resolved] INC-${before.number}: ${before.title}`, incidentId: before.id,
        payload: incidentPayload(ctx, { ...before, status: nextStatus }, `Incident INC-${before.number} resolved`, [
          { label: "Incident", value: before.title },
          { label: "Duration", value: formatDurationWords((now.getTime() - before.startedAt.getTime()) / 1000) },
          { label: "Resolved by", value: ctx.actor.name },
        ], now),
      });
      events.push({ type: "incident.resolved", incidentId: before.id, number: before.number, title: before.title, automated: false }, { type: "activity.created" });
    } else if (reopening) {
      await recordActivity(tx, {
        organizationId: ctx.organization.id, type: ActivityType.INCIDENT_REOPENED, level: ActivityLevel.WARNING,
        title: `INC-${before.number} reopened: ${before.title}`, description: `Reopened by ${ctx.actor.name}.`, incidentId: before.id, occurredAt: now,
      });
      events.push({ type: "activity.created" });
    }
    events.push({ type: "incident.updated", incidentId: before.id, number: before.number }, { type: "statuspage.changed" });
  });

  await publish(ctx.organization.id, ...events);
  return getIncident(ctx, incidentId);
}

export async function addIncidentNote(ctx: OrgContext, incidentId: string, input: CreateIncidentNoteInput): Promise<IncidentDetailDto> {
  authorize(ctx, "incident:write");
  const number = await prisma.$transaction(async (tx) => {
    const incident = await findIncident(tx, ctx, incidentId);
    await tx.incidentNote.create({ data: { incidentId: incident.id, organizationId: ctx.organization.id, authorId: ctx.actor.userId, body: input.body } });
    await tx.incident.update({ where: { id: incident.id }, data: { updatedAt: new Date() } });
    // The note body is deliberately not copied into the audit log.
    await recordAudit(tx, ctx, { action: "incident.note_added", target: { type: "incident", id: incident.id, label: `INC-${incident.number}` } });
    return incident.number;
  });
  await publish(ctx.organization.id, { type: "incident.updated", incidentId, number });
  return getIncident(ctx, incidentId);
}

export async function setIncidentMonitors(ctx: OrgContext, incidentId: string, monitorIds: string[]): Promise<IncidentDetailDto> {
  authorize(ctx, "incident:write");
  const unique = [...new Set(monitorIds)];
  const number = await prisma.$transaction(async (tx) => {
    const incident = await findIncident(tx, ctx, incidentId);
    await assertMonitorsInOrg(tx, ctx, unique);
    const current = new Set(incident.monitors.map((link) => link.monitor.id));
    const added = unique.filter((id) => !current.has(id));
    const removed = [...current].filter((id) => !unique.includes(id));
    if (added.length === 0 && removed.length === 0) return incident.number;
    if (removed.length) await tx.incidentMonitor.deleteMany({ where: { incidentId: incident.id, monitorId: { in: removed } } });
    if (added.length) {
      await tx.incidentMonitor.createMany({ data: added.map((monitorId) => ({ incidentId: incident.id, monitorId, organizationId: ctx.organization.id })) });
    }
    await tx.incidentUpdate.create({
      data: { incidentId: incident.id, organizationId: ctx.organization.id, kind: IncidentUpdateKind.SYSTEM, message: `${ctx.actor.name} updated the affected monitors.`, authorId: ctx.actor.userId },
    });
    await recordAudit(tx, ctx, { action: "incident.monitors_changed", target: { type: "incident", id: incident.id, label: `INC-${incident.number}` }, metadata: { added, removed } });
    return incident.number;
  });
  await publish(ctx.organization.id, { type: "incident.updated", incidentId, number }, { type: "statuspage.changed" });
  return getIncident(ctx, incidentId);
}

export async function deleteIncident(ctx: OrgContext, incidentId: string): Promise<void> {
  authorize(ctx, "incident:delete");
  const number = await prisma.$transaction(async (tx) => {
    const incident = await findIncident(tx, ctx, incidentId);
    await tx.incident.delete({ where: { id: incident.id } });
    await recordAudit(tx, ctx, { action: "incident.deleted", target: { type: "incident", id: incident.id, label: `INC-${incident.number}` }, metadata: { title: incident.title } });
    return incident.number;
  });
  await publish(ctx.organization.id, { type: "incident.updated", incidentId, number }, { type: "statuspage.changed" });
}

/** Field-level history for one incident, drawn from the audit log. */
export async function getIncidentActivity(ctx: OrgContext, incidentId: string): Promise<AuditLogDto[]> {
  authorize(ctx, "incident:read");
  const incident = await findIncident(prisma, ctx, incidentId);
  const rows = await prisma.auditLog.findMany({
    where: { organizationId: ctx.organization.id, targetType: "incident", targetId: incident.id },
    orderBy: { createdAt: "desc" }, take: 100,
  });
  return rows.map((row) => ({
    id: row.id, action: row.action, actorType: row.actorType, actorId: row.actorId, actorLabel: row.actorLabel,
    targetType: row.targetType, targetId: row.targetId, targetLabel: row.targetLabel,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    // IP addresses are for administrators reading the full audit log, not for this view.
    ipAddress: null, isSample: row.isSample, createdAt: iso(row.createdAt),
  }));
}
