import { z } from "zod";

import { DeliveryStatus, NotificationChannelType, NotificationEvent } from "../enums";
import { emailSchema } from "./auth";
import { csvEnum, cursorQuerySchema } from "./common";

const eventsSchema = z
  .array(z.enum(NotificationEvent))
  .min(1, "Choose at least one event.")
  .transform((events) => [...new Set(events)]);

const channelNameSchema = z
  .string()
  .trim()
  .min(2, "Give the channel a name.")
  .max(60, "Keep the name under 60 characters.");

const webhookUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
      } catch {
        return false;
      }
    },
    { error: "Enter a full URL, including https://, without credentials." },
  );

export const emailChannelSchema = z.object({
  type: z.literal(NotificationChannelType.EMAIL),
  name: channelNameSchema,
  recipients: z
    .array(emailSchema)
    .min(1, "Add at least one recipient.")
    .max(20, "A channel can have at most 20 recipients.")
    .transform((list) => [...new Set(list)]),
  events: eventsSchema,
  enabled: z.boolean().default(true),
});

export const webhookChannelSchema = z.object({
  type: z.literal(NotificationChannelType.WEBHOOK),
  name: channelNameSchema,
  url: webhookUrlSchema,
  events: eventsSchema,
  enabled: z.boolean().default(true),
});

export const createChannelSchema = z.discriminatedUnion("type", [emailChannelSchema, webhookChannelSchema]);

export const updateChannelSchema = z
  .object({
    name: channelNameSchema,
    recipients: emailChannelSchema.shape.recipients,
    url: webhookUrlSchema,
    events: eventsSchema,
    enabled: z.boolean(),
  })
  .partial()
  .refine((input) => Object.keys(input).length > 0, { error: "Nothing to update." });

export const listDeliveriesQuerySchema = cursorQuerySchema.extend({
  status: csvEnum(Object.values(DeliveryStatus) as [DeliveryStatus, ...DeliveryStatus[]]),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type CreateChannelFormValues = z.input<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;
