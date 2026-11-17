import { NotificationChannelType } from "@/shared/enums";
import type { CreateChannelInput, ListDeliveriesQuery, UpdateChannelInput } from "@/shared/schemas/notification";
import type { CreatedChannelDto, CursorPage, NotificationChannelDto, NotificationDeliveryDto, NotificationSettingsDto } from "@/shared/types";

import { recordAudit } from "../../audit";
import { generateSigningSecret } from "../../auth/tokens";
import { type Prisma, prisma } from "../../db";
import { getEnv, isEmailConfigured } from "../../env";
import { fieldError, notFound } from "../../errors";
import { assertTargetAllowed, SsrfBlockedError } from "../../monitoring/ssrf";
import { authorize, type OrgContext } from "../../tenancy";
import { iso, isoOrNull, maskDestination } from "../mappers";
import { getPreferences } from "../organizations/service";

type ChannelRow = Prisma.NotificationChannelGetPayload<object>;

function toChannelDto(row: ChannelRow): NotificationChannelDto {
  const config = (row.config ?? {}) as { recipients?: string[]; url?: string };
  return {
    id: row.id, type: row.type, name: row.name, enabled: row.enabled, events: row.events,
    recipients: row.type === NotificationChannelType.EMAIL ? (config.recipients ?? []) : [],
    url: row.type === NotificationChannelType.WEBHOOK ? (config.url ?? null) : null,
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  };
}

/** Webhooks are outbound requests to a user-supplied URL, so they get the same SSRF policy as checks. */
async function assertWebhookUrl(url: string): Promise<void> {
  try {
    await assertTargetAllowed(url);
  } catch (error) {
    if (error instanceof SsrfBlockedError) throw fieldError("url", error.message);
    throw error;
  }
}

async function findChannel(ctx: OrgContext, id: string): Promise<ChannelRow> {
  const channel = await prisma.notificationChannel.findFirst({ where: { id, organizationId: ctx.organization.id } });
  if (!channel) throw notFound("Notification channel");
  return channel;
}

export async function getNotificationSettings(ctx: OrgContext): Promise<NotificationSettingsDto> {
  authorize(ctx, "notification:read");
  const [preferences, channels] = await Promise.all([
    getPreferences(ctx),
    prisma.notificationChannel.findMany({ where: { organizationId: ctx.organization.id }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    emailConfigured: isEmailConfigured(), emailFrom: isEmailConfigured() ? getEnv().EMAIL_FROM : null,
    preferences, channels: channels.map(toChannelDto),
  };
}

export async function createChannel(ctx: OrgContext, input: CreateChannelInput): Promise<CreatedChannelDto> {
  authorize(ctx, "notification:manage");
  const isWebhook = input.type === NotificationChannelType.WEBHOOK;
  if (isWebhook) await assertWebhookUrl(input.url);
  const signingSecret = isWebhook ? generateSigningSecret() : null;
  const channel = await prisma.$transaction(async (tx) => {
    const created = await tx.notificationChannel.create({
      data: {
        organizationId: ctx.organization.id, type: input.type, name: input.name, events: input.events, enabled: input.enabled,
        config: isWebhook ? { url: input.url } : { recipients: input.recipients },
        signingSecret, createdById: ctx.actor.userId,
      },
    });
    await recordAudit(tx, ctx, {
      action: "notification_channel.created", target: { type: "notification_channel", id: created.id, label: created.name },
      metadata: { type: input.type, events: input.events },
    });
    return created;
  });
  return { ...toChannelDto(channel), signingSecret };
}

export async function updateChannel(ctx: OrgContext, id: string, input: UpdateChannelInput): Promise<NotificationChannelDto> {
  authorize(ctx, "notification:manage");
  const before = await findChannel(ctx, id);
  const isWebhook = before.type === NotificationChannelType.WEBHOOK;
  if (isWebhook && input.url) await assertWebhookUrl(input.url);
  const config = isWebhook ? (input.url ? { url: input.url } : undefined) : input.recipients ? { recipients: input.recipients } : undefined;
  const channel = await prisma.$transaction(async (tx) => {
    const updated = await tx.notificationChannel.update({
      where: { id: before.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.events !== undefined ? { events: input.events } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(config ? { config } : {}),
      },
    });
    await recordAudit(tx, ctx, {
      action: "notification_channel.updated", target: { type: "notification_channel", id: updated.id, label: updated.name },
      metadata: { fields: Object.keys(input) },
    });
    return updated;
  });
  return toChannelDto(channel);
}

export async function rotateChannelSecret(ctx: OrgContext, id: string): Promise<CreatedChannelDto> {
  authorize(ctx, "notification:manage");
  const before = await findChannel(ctx, id);
  if (before.type !== NotificationChannelType.WEBHOOK) throw fieldError("type", "Only webhook channels have a signing secret.");
  const signingSecret = generateSigningSecret();
  const channel = await prisma.$transaction(async (tx) => {
    const updated = await tx.notificationChannel.update({ where: { id: before.id }, data: { signingSecret } });
    await recordAudit(tx, ctx, { action: "notification_channel.secret_rotated", target: { type: "notification_channel", id: updated.id, label: updated.name } });
    return updated;
  });
  return { ...toChannelDto(channel), signingSecret };
}

export async function deleteChannel(ctx: OrgContext, id: string): Promise<void> {
  authorize(ctx, "notification:manage");
  const channel = await findChannel(ctx, id);
  await prisma.$transaction(async (tx) => {
    await tx.notificationChannel.delete({ where: { id: channel.id } });
    await recordAudit(tx, ctx, { action: "notification_channel.deleted", target: { type: "notification_channel", id: channel.id, label: channel.name } });
  });
}

export async function listDeliveries(ctx: OrgContext, query: ListDeliveriesQuery): Promise<CursorPage<NotificationDeliveryDto>> {
  authorize(ctx, "notification:read");
  const rows = await prisma.notificationDelivery.findMany({
    where: { organizationId: ctx.organization.id, ...(query.status?.length ? { status: { in: query.status } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: {
      channel: { select: { name: true } }, incident: { select: { id: true, number: true } }, monitor: { select: { id: true, name: true } },
    },
  });
  const page = rows.slice(0, query.limit);
  return {
    items: page.map((row) => ({
      id: row.id, channelType: row.channelType, channelName: row.channel?.name ?? (row.userId ? "Personal email" : null),
      destination: maskDestination(row.recipient), event: row.event, subject: row.subject, status: row.status, attempts: row.attempts,
      lastError: row.lastError, incident: row.incident, monitor: row.monitor, createdAt: iso(row.createdAt), sentAt: isoOrNull(row.sentAt),
    })),
    nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}
