import type { ActivityDto, ActivityInboxDto, AuditLogDto, CursorPage, SearchResultsDto } from "@/shared/types";

import { prisma } from "../../db";
import { authorize, type OrgContext } from "../../tenancy";
import { iso, isoOrNull } from "../mappers";

export interface ActivityQuery { cursor?: string; limit: number; monitorId?: string }

export async function listActivity(ctx: OrgContext, query: ActivityQuery): Promise<ActivityInboxDto> {
  authorize(ctx, "monitor:read");
  const where = { organizationId: ctx.organization.id, ...(query.monitorId ? { monitorId: query.monitorId } : {}) };
  const [rows, membership] = await Promise.all([
    prisma.activityEvent.findMany({
      where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    }),
    prisma.organizationMember.findUniqueOrThrow({ where: { id: ctx.membershipId }, select: { activitySeenAt: true } }),
  ]);
  const unreadCount = await prisma.activityEvent.count({
    where: { organizationId: ctx.organization.id, ...(membership.activitySeenAt ? { occurredAt: { gt: membership.activitySeenAt } } : {}) },
  });
  const page = rows.slice(0, query.limit);
  const items: ActivityDto[] = page.map((row) => ({
    id: row.id, type: row.type, level: row.level, title: row.title, description: row.description, monitorId: row.monitorId,
    incidentId: row.incidentId, isSample: row.isSample, occurredAt: iso(row.occurredAt),
  }));
  return {
    items, nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
    unreadCount: Math.min(unreadCount, 99), seenAt: isoOrNull(membership.activitySeenAt),
  };
}

export async function markActivitySeen(ctx: OrgContext): Promise<void> {
  await prisma.organizationMember.update({ where: { id: ctx.membershipId }, data: { activitySeenAt: new Date() } });
}

export interface AuditQuery { cursor?: string; limit: number; action?: string; q?: string }

export async function listAuditLog(ctx: OrgContext, query: AuditQuery): Promise<CursorPage<AuditLogDto>> {
  authorize(ctx, "audit:read");
  const rows = await prisma.auditLog.findMany({
    where: {
      organizationId: ctx.organization.id,
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.q ? { OR: [{ actorLabel: { contains: query.q, mode: "insensitive" } }, { targetLabel: { contains: query.q, mode: "insensitive" } }, { action: { contains: query.q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, query.limit);
  return {
    items: page.map((row) => ({
      id: row.id, action: row.action, actorType: row.actorType, actorId: row.actorId, actorLabel: row.actorLabel,
      targetType: row.targetType, targetId: row.targetId, targetLabel: row.targetLabel,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null, ipAddress: row.ipAddress, isSample: row.isSample, createdAt: iso(row.createdAt),
    })),
    nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Powers the command palette. Scoped to the organization like everything else. */
export async function search(ctx: OrgContext, term: string): Promise<SearchResultsDto> {
  authorize(ctx, "monitor:read");
  const organizationId = ctx.organization.id;
  const contains = { contains: term, mode: "insensitive" as const };
  const number = /^(?:inc-?)?(\d{1,9})$/i.exec(term);
  const [monitors, incidents, statusPages] = await Promise.all([
    prisma.monitor.findMany({
      where: { organizationId, ...(term ? { OR: [{ name: contains }, { url: contains }] } : {}) },
      select: { id: true, name: true, url: true, status: true }, orderBy: { name: "asc" }, take: 8,
    }),
    prisma.incident.findMany({
      where: { organizationId, ...(term ? { OR: [{ title: contains }, ...(number ? [{ number: Number(number[1]) }] : [])] } : {}) },
      select: { id: true, number: true, title: true, status: true, severity: true }, orderBy: { startedAt: "desc" }, take: 6,
    }),
    prisma.statusPage.findMany({
      where: { organizationId, ...(term ? { name: contains } : {}) },
      select: { id: true, name: true, slug: true, published: true }, orderBy: { name: "asc" }, take: 4,
    }),
  ]);
  return { monitors, incidents, statusPages };
}
