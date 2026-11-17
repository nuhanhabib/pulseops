import { orgRoute } from "@/server/http/handler";
import { updatePreferences } from "@/server/modules/organizations/service";
import { notificationPreferencesSchema } from "@/shared/schemas/organization";

// Personal preferences: every member, viewers included, controls their own email.
export const PUT = orgRoute({ permission: "notification:read", body: notificationPreferencesSchema }, ({ ctx, body }) =>
  updatePreferences(ctx, body),
);
