import { prisma } from "@/server/db";
import { publicRoute, sessionRoute } from "@/server/http/handler";
import { acceptInvitation, previewInvitation } from "@/server/modules/organizations/service";
import { RATE_LIMITS } from "@/server/rate-limit";

export const GET = publicRoute({ rateLimit: { rule: RATE_LIMITS.invitationLookup, by: "ip" } }, ({ params }) =>
  previewInvitation(params.token ?? ""),
);

export const POST = sessionRoute({}, ({ session, params, meta }) =>
  prisma.$transaction((tx) =>
    acceptInvitation(tx, { userId: session.user.id, email: session.user.email, name: session.user.name }, params.token ?? "", meta),
  ),
);
