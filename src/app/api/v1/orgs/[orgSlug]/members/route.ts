import { orgRoute } from "@/server/http/handler";
import { listMembers } from "@/server/modules/organizations/service";

export const GET = orgRoute({ permission: "member:read" }, ({ ctx }) => listMembers(ctx));
