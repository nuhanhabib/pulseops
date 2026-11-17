import { IncidentStatus, MonitorStatus } from "@/shared/enums";
import type { CreateStatusPageInput, UpdateStatusPageInput } from "@/shared/schemas/status-page";
import type {
  PublicComponentStatus, PublicIncidentDto, PublicOverallStatus, PublicStatusPageDto, StatusPageDto,
} from "@/shared/types";
import { uptimePercent } from "@/shared/uptime";

import { recordAudit } from "../../audit";
import { type DbClient, isUniqueViolation, type Prisma, prisma } from "../../db";
import { conflict, fieldError, notFound } from "../../errors";
import { publish } from "../../realtime/publisher";
import { authorize, type OrgContext } from "../../tenancy";
import { iso } from "../mappers";
import { loadDailyAvailability } from "../metrics/queries";

const include = {
  monitors: { orderBy: { sortOrder: "asc" }, include: { monitor: { select: { name: true, status: true } } } },
} satisfies Prisma.StatusPageInclude;

type PageRow = Prisma.StatusPageGetPayload<{ include: typeof include }>;

function toDto(row: PageRow): StatusPageDto {
  return {
    id: row.id, slug: row.slug, name: row.name, description: row.description, published: row.published, accentColor: row.accentColor,
    theme: row.theme, uptimeDays: row.uptimeDays, showIncidentHistory: row.showIncidentHistory, supportUrl: row.supportUrl,
    monitors: row.monitors.map((link) => ({
      monitorId: link.monitorId, monitorName: link.monitor.name, displayName: link.displayName, description: link.description, status: link.monitor.status,
    })),
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  };
}

async function findPage(db: DbClient, ctx: OrgContext, id: string): Promise<PageRow> {
  const page = await db.statusPage.findFirst({ where: { id, organizationId: ctx.organization.id }, include });
  if (!page) throw notFound("Status page");
  return page;
}

async function assertMonitors(db: DbClient, ctx: OrgContext, monitorIds: string[]): Promise<void> {
  if (monitorIds.length === 0) return;
  const count = await db.monitor.count({ where: { organizationId: ctx.organization.id, id: { in: monitorIds } } });
  if (count !== monitorIds.length) throw fieldError("monitors", "One or more monitors could not be found.");
}

const slugTaken = () => conflict("That address is already taken.", { slug: ["That address is already taken."] });

export async function listStatusPages(ctx: OrgContext): Promise<StatusPageDto[]> {
  authorize(ctx, "statuspage:read");
  const rows = await prisma.statusPage.findMany({ where: { organizationId: ctx.organization.id }, include, orderBy: { createdAt: "asc" } });
  return rows.map(toDto);
}

export async function getStatusPage(ctx: OrgContext, id: string): Promise<StatusPageDto> {
  authorize(ctx, "statuspage:read");
  return toDto(await findPage(prisma, ctx, id));
}

export async function createStatusPage(ctx: OrgContext, input: CreateStatusPageInput): Promise<StatusPageDto> {
  authorize(ctx, "statuspage:write");
  const { monitors, ...fields } = input;
  try {
    const page = await prisma.$transaction(async (tx) => {
      await assertMonitors(tx, ctx, monitors.map((item) => item.monitorId));
      const created = await tx.statusPage.create({
        data: {
          ...fields, organizationId: ctx.organization.id,
          monitors: { create: monitors.map((item, index) => ({ ...item, sortOrder: index })) },
        },
        include,
      });
      await recordAudit(tx, ctx, { action: "status_page.created", target: { type: "status_page", id: created.id, label: created.name }, metadata: { slug: created.slug, published: created.published } });
      return created;
    });
    await publish(ctx.organization.id, { type: "statuspage.changed" });
    return toDto(page);
  } catch (error) {
    if (isUniqueViolation(error, "slug")) throw slugTaken();
    throw error;
  }
}

export async function updateStatusPage(ctx: OrgContext, id: string, input: UpdateStatusPageInput): Promise<StatusPageDto> {
  authorize(ctx, "statuspage:write");
  const { monitors, ...fields } = input;
  try {
    const page = await prisma.$transaction(async (tx) => {
      const before = await findPage(tx, ctx, id);
      if (monitors) {
        await assertMonitors(tx, ctx, monitors.map((item) => item.monitorId));
        await tx.statusPageMonitor.deleteMany({ where: { statusPageId: before.id } });
        await tx.statusPageMonitor.createMany({ data: monitors.map((item, index) => ({ ...item, statusPageId: before.id, sortOrder: index })) });
      }
      const updated = await tx.statusPage.update({ where: { id: before.id }, data: fields, include });
      const action =
        fields.published === true && !before.published ? "status_page.published"
        : fields.published === false && before.published ? "status_page.unpublished" : "status_page.updated";
      await recordAudit(tx, ctx, {
        action, target: { type: "status_page", id: updated.id, label: updated.name },
        metadata: { fields: Object.keys(fields), componentsChanged: Boolean(monitors) },
      });
      return updated;
    });
    await publish(ctx.organization.id, { type: "statuspage.changed" });
    return toDto(page);
  } catch (error) {
    if (isUniqueViolation(error, "slug")) throw slugTaken();
    throw error;
  }
}

export async function deleteStatusPage(ctx: OrgContext, id: string): Promise<void> {
  authorize(ctx, "statuspage:write");
  await prisma.$transaction(async (tx) => {
    const page = await findPage(tx, ctx, id);
    await tx.statusPage.delete({ where: { id: page.id } });
    await recordAudit(tx, ctx, { action: "status_page.deleted", target: { type: "status_page", id: page.id, label: page.name }, metadata: { slug: page.slug } });
  });
  await publish(ctx.organization.id, { type: "statuspage.changed" });
}

// ── Public read model ───────────────────────────────────────────────────────

const componentStatus = (status: MonitorStatus): PublicComponentStatus =>
  status === MonitorStatus.UP ? "operational" : status === MonitorStatus.DEGRADED ? "degraded" : status === MonitorStatus.DOWN ? "outage" : "unknown";

function overallStatus(statuses: PublicComponentStatus[]): PublicOverallStatus {
  const known = statuses.filter((status) => status !== "unknown");
  if (known.length === 0) return "unknown";
  const outages = known.filter((status) => status === "outage").length;
  if (outages === known.length) return "major_outage";
  if (outages > 0) return "partial_outage";
  if (known.includes("degraded")) return "degraded";
  return "operational";
}

const HISTORY_DAYS = 14;

/**
 * The only function that produces data for an unauthenticated visitor.
 *
 * It is written as an allowlist: it selects exactly the columns it publishes
 * and builds its own DTO. It never reads monitor URLs, private monitor names,
 * internal notes, system-generated timeline entries, assignees, or anything
 * about members. Unpublished pages are indistinguishable from missing ones.
 */
export async function getPublicStatusPage(slug: string, now: Date = new Date()): Promise<PublicStatusPageDto | null> {
  const page = await prisma.statusPage.findFirst({
    where: { slug, published: true },
    select: {
      organizationId: true, name: true, description: true, accentColor: true, theme: true, supportUrl: true, uptimeDays: true,
      showIncidentHistory: true,
      monitors: {
        orderBy: { sortOrder: "asc" },
        select: { monitorId: true, displayName: true, description: true, monitor: { select: { status: true, isSample: true } } },
      },
    },
  });
  if (!page) return null;

  const monitorIds = page.monitors.map((link) => link.monitorId);
  const publicName = new Map(page.monitors.map((link) => [link.monitorId, link.displayName]));
  const availability = await loadDailyAvailability(page.organizationId, page.uptimeDays, monitorIds, now);

  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  const incidents = monitorIds.length
    ? await prisma.incident.findMany({
        where: {
          organizationId: page.organizationId,
          isPublic: true,
          monitors: { some: { monitorId: { in: monitorIds } } },
          OR: [{ status: { not: IncidentStatus.RESOLVED } }, ...(page.showIncidentHistory ? [{ resolvedAt: { gte: since } }] : [])],
        },
        orderBy: { startedAt: "desc" },
        take: 25,
        select: {
          id: true, title: true, status: true, severity: true, startedAt: true, resolvedAt: true, isSample: true,
          monitors: { where: { monitorId: { in: monitorIds } }, select: { monitorId: true } },
          // Human-written, explicitly published updates only.
          updates: {
            where: { isPublic: true, kind: "UPDATE" }, orderBy: { createdAt: "desc" },
            select: { id: true, status: true, message: true, createdAt: true },
          },
        },
      })
    : [];

  const toPublicIncident = (incident: (typeof incidents)[number]): PublicIncidentDto => ({
    id: incident.id, title: incident.title, status: incident.status, severity: incident.severity,
    startedAt: iso(incident.startedAt), resolvedAt: incident.resolvedAt ? iso(incident.resolvedAt) : null,
    components: incident.monitors.map((link) => publicName.get(link.monitorId)).filter((name): name is string => Boolean(name)),
    updates: incident.updates.map((update) => ({ id: update.id, status: update.status, message: update.message, createdAt: iso(update.createdAt) })),
  });

  const components = page.monitors.map((link) => {
    const days = availability.get(link.monitorId) ?? [];
    const totals = days.reduce((sum, day) => ({ total: sum.total + day.total, down: sum.down + day.down }), { total: 0, down: 0 });
    return {
      name: link.displayName, description: link.description, status: componentStatus(link.monitor.status),
      uptime: uptimePercent(totals), days: days.map((day) => ({ date: day.date, uptime: day.uptime })),
    };
  });

  return {
    name: page.name, description: page.description, accentColor: page.accentColor, theme: page.theme, supportUrl: page.supportUrl,
    uptimeDays: page.uptimeDays, overall: overallStatus(components.map((component) => component.status)), generatedAt: iso(now),
    components,
    activeIncidents: incidents.filter((incident) => incident.status !== IncidentStatus.RESOLVED).map(toPublicIncident),
    pastIncidents: incidents.filter((incident) => incident.status === IncidentStatus.RESOLVED).map(toPublicIncident),
    containsSampleData: page.monitors.some((link) => link.monitor.isSample) || incidents.some((incident) => incident.isSample),
  };
}
