import { z } from "zod";

import { orgRoute } from "@/server/http/handler";
import { getDashboard } from "@/server/modules/dashboard/service";
import { timeRangeSchema } from "@/shared/schemas/common";

export const GET = orgRoute({ permission: "monitor:read", query: z.object({ range: timeRangeSchema }) }, ({ ctx, query }) =>
  getDashboard(ctx, query.range),
);
