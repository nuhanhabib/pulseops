import type { Job } from "bullmq";
import nodemailer, { type Transporter } from "nodemailer";

import { signWebhookPayload } from "@/server/auth/tokens";
import { prisma } from "@/server/db";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { classifyError } from "@/server/monitoring/http-check";
import { safePostJson } from "@/server/monitoring/safe-post";
import type { NotificationPayload } from "@/server/modules/notifications/outbox";
import { checkRateLimit } from "@/server/rate-limit";
import { publish } from "@/server/realtime/publisher";
import { APP_NAME } from "@/shared/constants";
import { DeliveryStatus, NotificationChannelType } from "@/shared/enums";

import type { NotificationJobData } from "../queues";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const url = getEnv().SMTP_URL;
  if (!url) return null;
  transporter ??= nodemailer.createTransport(url);
  return transporter;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Every interpolated value is escaped: monitor names and incident titles are user input. */
export function renderEmail(subject: string, payload: NotificationPayload, link: string): { html: string; text: string } {
  const rows = payload.facts
    .map(
      (fact) =>
        `<tr><td style="padding:6px 16px 6px 0;color:#656c7b;font-size:13px;white-space:nowrap;vertical-align:top">${escapeHtml(fact.label)}</td><td style="padding:6px 0;color:#121826;font-size:13px">${escapeHtml(fact.value)}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e0e3e9;border-radius:12px">
<tr><td style="padding:24px 28px 0"><div style="font-size:13px;font-weight:600;color:#4f45db;letter-spacing:.02em">${escapeHtml(APP_NAME)} · ${escapeHtml(payload.organization.name)}</div>
<h1 style="margin:10px 0 4px;font-size:20px;line-height:1.3;color:#121826">${escapeHtml(payload.headline)}</h1></td></tr>
<tr><td style="padding:12px 28px 4px"><table role="presentation" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
<tr><td style="padding:16px 28px 28px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#4f45db;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px">Open in ${escapeHtml(APP_NAME)}</a></td></tr>
</table>
<div style="max-width:560px;padding:16px 4px;color:#8d929f;font-size:12px">You are receiving this because of your notification settings for ${escapeHtml(payload.organization.name)}.</div>
</td></tr></table></body></html>`;
  const text = [payload.headline, "", ...payload.facts.map((fact) => `${fact.label}: ${fact.value}`), "", link].join("\n");
  return { html, text };
}

async function finish(id: string, organizationId: string, status: DeliveryStatus, lastError: string | null, attempts: number) {
  await prisma.notificationDelivery.update({
    where: { id },
    data: { status, lastError, attempts, sentAt: status === DeliveryStatus.SENT ? new Date() : null },
  });
  await publish(organizationId, { type: "notification.updated" });
}

/**
 * Delivers one outbox row. Throwing makes BullMQ retry with exponential
 * backoff; the row is marked FAILED only after the final attempt. A row that
 * is no longer PENDING is skipped, which makes redelivery of a job harmless.
 */
export async function processNotificationJob(job: Job<NotificationJobData>): Promise<{ status: string }> {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: job.data.deliveryId },
    include: { channel: { select: { enabled: true, signingSecret: true } } },
  });
  if (!delivery || delivery.status !== DeliveryStatus.PENDING) return { status: "skipped" };

  const attempt = job.attemptsMade + 1;
  const payload = delivery.payload as unknown as NotificationPayload;
  const link = `${getEnv().APP_URL}${payload.path}`;

  if (delivery.channelId && delivery.channel && !delivery.channel.enabled) {
    await finish(delivery.id, delivery.organizationId, DeliveryStatus.SKIPPED, "The channel was disabled before delivery.", attempt);
    return { status: "skipped" };
  }

  // Per-destination ceiling, so a flapping monitor cannot flood an inbox or an endpoint.
  const limit = await checkRateLimit(
    { bucket: "notify:dest", limit: getEnv().NOTIFICATION_MAX_PER_HOUR, windowSeconds: 3600 },
    `${delivery.organizationId}:${delivery.recipient}`,
  );
  if (!limit.allowed) {
    await finish(delivery.id, delivery.organizationId, DeliveryStatus.SUPPRESSED, "Suppressed by the hourly limit for this destination.", attempt);
    return { status: "suppressed" };
  }

  try {
    if (delivery.channelType === NotificationChannelType.EMAIL) {
      const transport = getTransporter();
      if (!transport) {
        // Safe fallback: the event is recorded and visible in the delivery log, nothing is sent.
        await finish(delivery.id, delivery.organizationId, DeliveryStatus.SKIPPED, "No email provider is configured (SMTP_URL is not set).", attempt);
        return { status: "skipped" };
      }
      const { html, text } = renderEmail(delivery.subject, payload, link);
      await transport.sendMail({ from: getEnv().EMAIL_FROM, to: delivery.recipient, subject: delivery.subject, html, text });
    } else {
      const timestamp = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({
        id: delivery.id, event: delivery.event, occurredAt: payload.occurredAt, summary: payload.headline, link,
        organization: payload.organization, monitor: payload.monitor ?? null, incident: payload.incident ?? null,
      });
      const secret = delivery.channel?.signingSecret;
      const response = await safePostJson(delivery.recipient, body, {
        "User-Agent": "PulseOps-Webhooks/1.0",
        "X-PulseOps-Event": delivery.event,
        "X-PulseOps-Delivery": delivery.id,
        "X-PulseOps-Timestamp": String(timestamp),
        ...(secret ? { "X-PulseOps-Signature": `sha256=${signWebhookPayload(secret, timestamp, body)}` } : {}),
      });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Object.assign(new Error(`Endpoint responded with HTTP ${response.statusCode}.`), { webhookStatus: response.statusCode });
      }
    }
    await finish(delivery.id, delivery.organizationId, DeliveryStatus.SENT, null, attempt);
    return { status: "sent" };
  } catch (error) {
    const webhookStatus = (error as { webhookStatus?: number }).webhookStatus;
    const message = webhookStatus
      ? `Endpoint responded with HTTP ${webhookStatus}.`
      : delivery.channelType === NotificationChannelType.WEBHOOK
        ? classifyError(error).errorMessage
        : `SMTP delivery failed (${String((error as { code?: unknown }).code ?? "error")}).`;
    const final = attempt >= (job.opts.attempts ?? 1);
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { attempts: attempt, lastError: message, ...(final ? { status: DeliveryStatus.FAILED } : {}) },
    });
    if (final) await publish(delivery.organizationId, { type: "notification.updated" });
    logger.warn({ deliveryId: delivery.id, attempt, final, error: message }, "notification delivery failed");
    throw error;
  }
}
