import { z } from "zod";

import { orgRoute } from "@/server/http/handler";
import { listAuditLog } from "@/server/modules/activity/service";
import { cursorQuerySchema, searchTermSchema } from "@/shared/schemas/common";

const query = cursorQuerySchema.extend({ q: searchTermSchema, action: z.string().trim().regex(/^[a-z_.]{1,60}$/).optional() });

export const GET = orgRoute({ permission: "audit:read", query }, ({ ctx, query }) => listAuditLog(ctx, query));
