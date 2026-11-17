import { notFound } from "@/server/errors";
import { ok, publicRoute } from "@/server/http/handler";
import { getPublicStatusPage } from "@/server/modules/status-pages/service";
import { RATE_LIMITS } from "@/server/rate-limit";

/** Unauthenticated, read-only, rate limited, and briefly cacheable by CDNs. */
export const GET = publicRoute({ rateLimit: { rule: RATE_LIMITS.publicStatus, by: "ip" } }, async ({ params }) => {
  const page = await getPublicStatusPage(params.slug ?? "");
  if (!page) throw notFound("Status page");
  const response = ok(page);
  response.headers.set("Cache-Control", "public, max-age=15, s-maxage=30, stale-while-revalidate=60");
  return response;
});
