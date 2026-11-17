import { created, orgRoute } from "@/server/http/handler";
import { createInvitation, listInvitations } from "@/server/modules/organizations/service";
import { RATE_LIMITS } from "@/server/rate-limit";
import { createInvitationSchema } from "@/shared/schemas/organization";

export const GET = orgRoute({ permission: "member:manage" }, ({ ctx }) => listInvitations(ctx));
export const POST = orgRoute(
  { permission: "member:manage", body: createInvitationSchema, rateLimit: { rule: RATE_LIMITS.invitationsSent, by: "org" } },
  async ({ ctx, body }) => created(await createInvitation(ctx, body)),
);
