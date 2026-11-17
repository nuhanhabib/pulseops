import { z } from "zod";

import { orgRoute } from "@/server/http/handler";
import { search } from "@/server/modules/activity/service";

export const GET = orgRoute({ permission: "monitor:read", query: z.object({ q: z.string().trim().max(80).default("") }) }, ({ ctx, query }) =>
  search(ctx, query.q),
);
