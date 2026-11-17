import { orgRoute } from "@/server/http/handler";
import { getAiStatus } from "@/server/modules/ai/service";

export const GET = orgRoute({ permission: "incident:read" }, async () => getAiStatus());
