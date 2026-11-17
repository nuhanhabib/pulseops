import { created, sessionRoute } from "@/server/http/handler";
import { createOrganization, listMemberships } from "@/server/modules/organizations/service";
import { createOrganizationSchema } from "@/shared/schemas/organization";

export const GET = sessionRoute({}, ({ session }) => listMemberships(session.user.id));
export const POST = sessionRoute({ body: createOrganizationSchema }, async ({ session, body, meta }) =>
  created(await createOrganization({ userId: session.user.id, email: session.user.email, name: session.user.name }, body, meta)),
);
