import { created, orgRoute } from "@/server/http/handler";
import { createStatusPage, listStatusPages } from "@/server/modules/status-pages/service";
import { createStatusPageSchema } from "@/shared/schemas/status-page";

export const GET = orgRoute({ permission: "statuspage:read" }, ({ ctx }) => listStatusPages(ctx));
export const POST = orgRoute({ permission: "statuspage:write", body: createStatusPageSchema }, async ({ ctx, body }) =>
  created(await createStatusPage(ctx, body)),
);
