import { orgRoute } from "@/server/http/handler";
import { listCategories } from "@/server/modules/monitors/service";

export const GET = orgRoute({ permission: "monitor:read" }, ({ ctx }) => listCategories(ctx));
