import { randomUUID } from "node:crypto";

import { type z, ZodError } from "zod";

import type { Permission } from "@/shared/permissions";
import type { ApiErrorBody } from "@/shared/types";

import { clearedSessionCookie, readSessionToken, sessionCookie } from "../auth/cookies";
import { type AuthSession, validateSessionToken } from "../auth/sessions";
import { isRecordNotFound, isUniqueViolation } from "../db";
import { getEnv, isSecureOrigin } from "../env";
import { AppError, type ErrorCode, ERROR_STATUS, limiterUnavailable, rateLimited, unauthenticated } from "../errors";
import { logger, serializeError } from "../logger";
import { checkRateLimit, RATE_LIMITS, type RateLimitRule } from "../rate-limit";
import { authorize, type OrgContext, type RequestMeta, resolveOrgContext } from "../tenancy";

/**
 * The single entry point for every API route.
 *
 * A route file declares *what* it needs (auth, permission, schemas, limits)
 * and supplies a function that calls a service. Everything cross-cutting lives
 * here exactly once: request ids, CSRF, authentication, tenant resolution,
 * authorization, validation, rate limiting, error mapping, and access logs.
 */

const MAX_BODY_BYTES = 100 * 1024;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type RouteParams = Record<string, string | string[] | undefined>;
type RouteContext = { params: Promise<RouteParams> };
type Schema = z.ZodType;
type Infer<S> = S extends Schema ? z.output<S> : undefined;

interface RateLimitConfig {
  rule: RateLimitRule;
  /** Defaults to "user" on authenticated routes and "ip" on public ones. */
  by?: "ip" | "user" | "org";
}

interface BaseConfig<B, Q> {
  body?: B;
  query?: Q;
  rateLimit?: RateLimitConfig;
}

export interface HandlerArgs<B, Q> {
  request: Request;
  requestId: string;
  meta: RequestMeta;
  params: Record<string, string>;
  body: Infer<B>;
  query: Infer<Q>;
  /** Append headers (for example Set-Cookie) to the eventual response. */
  responseHeaders: Headers;
}

export interface SessionArgs<B, Q> extends HandlerArgs<B, Q> {
  session: AuthSession;
}

export interface OrgArgs<B, Q> extends SessionArgs<B, Q> {
  ctx: OrgContext;
}

// ── Responses ───────────────────────────────────────────────────────────────

export function ok<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status });
}

export const created = <T>(data: T) => ok(data, 201);
export const noContent = () => new Response(null, { status: 204 });

function errorResponse(code: ErrorCode, message: string, requestId: string, extra: Partial<ApiErrorBody["error"]> = {}) {
  const body: ApiErrorBody = { error: { code, message, ...extra, requestId } };
  return Response.json(body, { status: ERROR_STATUS[code] });
}

// ── Request helpers ─────────────────────────────────────────────────────────

/** Reads the client address `TRUSTED_PROXY_HOPS` entries from the right of X-Forwarded-For. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return headers.get("x-real-ip");
  const chain = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
  if (chain.length === 0) return null;
  const hops = Math.max(1, getEnv().TRUSTED_PROXY_HOPS);
  return chain[Math.max(0, chain.length - hops)] ?? null;
}

/**
 * CSRF defence for cookie-authenticated writes. Browsers attach `Origin` to
 * every cross-origin and every non-GET same-origin request, so a mismatch
 * means the request was forged from another site. Requests with neither
 * `Origin` nor `Sec-Fetch-Site` are not from a browser and carry no ambient
 * credentials worth forging.
 */
export function assertSameOrigin(request: Request): void {
  if (!MUTATING.has(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    const appHost = new URL(getEnv().APP_URL).host;
    if (originHost && (originHost === host || originHost === appHost)) return;
    throw new AppError("csrf_rejected", "Cross-site request rejected.");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new AppError("csrf_rejected", "Cross-site request rejected.");
  }
}

function zodFields(error: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

async function parseBody(request: Request, schema: Schema): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AppError("unsupported_media_type", "Send the request body as application/json.");
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    throw new AppError("payload_too_large", "Request body is too large.");
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new AppError("payload_too_large", "Request body is too large.");
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("bad_request", "Request body is not valid JSON.");
  }
  return schema.parse(json);
}

function parseQuery(request: Request, schema: Schema): unknown {
  const search = new URL(request.url).searchParams;
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(search.keys())) {
    const values = search.getAll(key);
    raw[key] = values.length > 1 ? values : (values[0] ?? "");
  }
  return schema.parse(raw);
}

function toErrorResponse(error: unknown, requestId: string, log: Record<string, unknown>): Response {
  if (error instanceof AppError) {
    const response = errorResponse(error.code, error.message, requestId, error.fields ? { fields: error.fields } : {});
    if (error.retryAfterSeconds) response.headers.set("Retry-After", String(error.retryAfterSeconds));
    return response;
  }
  if (error instanceof ZodError) {
    return errorResponse("validation_failed", "Some fields need attention.", requestId, { fields: zodFields(error) });
  }
  if (isUniqueViolation(error)) return errorResponse("conflict", "That value is already in use.", requestId);
  if (isRecordNotFound(error)) return errorResponse("not_found", "Resource not found.", requestId);
  logger.error({ ...log, err: serializeError(error) }, "unhandled error in API route");
  return errorResponse("internal_error", "Something went wrong on our side.", requestId);
}

// ── Core ────────────────────────────────────────────────────────────────────

type Mode = "public" | "session" | "org";

function build<B extends Schema | undefined, Q extends Schema | undefined>(
  mode: Mode,
  config: BaseConfig<B, Q> & { permission?: Permission },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (args: any) => Promise<unknown>,
) {
  return async (request: Request, context: RouteContext): Promise<Response> => {
    const started = performance.now();
    const requestId = request.headers.get("x-request-id")?.slice(0, 64) || randomUUID();
    const meta: RequestMeta = {
      requestId,
      ipAddress: clientIp(request.headers),
      userAgent: request.headers.get("user-agent"),
    };
    const responseHeaders = new Headers();
    const log: Record<string, unknown> = { requestId, method: request.method, path: new URL(request.url).pathname };
    let response: Response;

    try {
      assertSameOrigin(request);

      const rawParams = (await context?.params) ?? {};
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawParams)) {
        if (typeof value === "string") params[key] = value;
      }

      let session: AuthSession | null = null;
      let ctx: OrgContext | undefined;

      if (mode !== "public") {
        session = await validateSessionToken(readSessionToken(request.headers.get("cookie")));
        if (!session) {
          responseHeaders.append("Set-Cookie", clearedSessionCookie(isSecureOrigin()));
          throw unauthenticated();
        }
        log.userId = session.user.id;
        if (session.refreshed) {
          const token = readSessionToken(request.headers.get("cookie"));
          if (token) responseHeaders.append("Set-Cookie", sessionCookie(token, session.expiresAt, isSecureOrigin()));
        }
      }

      if (mode === "org" && session) {
        ctx = await resolveOrgContext(
          { userId: session.user.id, email: session.user.email, name: session.user.name },
          params.orgSlug ?? "",
          meta,
        );
        log.orgId = ctx.organization.id;
        if (config.permission) authorize(ctx, config.permission);
      }

      const limits: RateLimitConfig[] = [];
      if (config.rateLimit) limits.push(config.rateLimit);
      if (session && MUTATING.has(request.method)) limits.push({ rule: RATE_LIMITS.mutations, by: "user" });
      for (const limit of limits) {
        const by = limit.by ?? (session ? "user" : "ip");
        const identifier =
          by === "org" && ctx ? ctx.organization.id : by === "user" && session ? session.user.id : (meta.ipAddress ?? "unknown");
        const result = await checkRateLimit(limit.rule, identifier);
        if (!result.allowed) throw result.storeUnavailable ? limiterUnavailable() : rateLimited(result.retryAfterSeconds);
      }

      const query = config.query ? parseQuery(request, config.query) : undefined;
      const body = config.body ? await parseBody(request, config.body) : undefined;

      const result = await fn({ request, requestId, meta, params, body, query, responseHeaders, session, ctx });
      response = result instanceof Response ? result : ok(result);
    } catch (error) {
      response = toErrorResponse(error, requestId, log);
    }

    response.headers.set("X-Request-Id", requestId);
    if (!response.headers.has("Cache-Control")) response.headers.set("Cache-Control", "no-store");
    responseHeaders.forEach((value, key) => response.headers.append(key, value));

    const level = response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info";
    logger[level]({ ...log, status: response.status, durationMs: Math.round(performance.now() - started) }, "api request");
    return response;
  };
}

/** No authentication. Always pair with a rate limit. */
export function publicRoute<B extends Schema | undefined = undefined, Q extends Schema | undefined = undefined>(
  config: BaseConfig<B, Q>,
  fn: (args: HandlerArgs<B, Q>) => Promise<unknown>,
) {
  return build("public", config, fn);
}

/** Requires a signed-in user, but no organization. */
export function sessionRoute<B extends Schema | undefined = undefined, Q extends Schema | undefined = undefined>(
  config: BaseConfig<B, Q>,
  fn: (args: SessionArgs<B, Q>) => Promise<unknown>,
) {
  return build("session", config, fn);
}

/**
 * Requires membership of the organization named by the `[orgSlug]` route
 * segment and, when given, a permission. The handler receives an `OrgContext`
 * that every service call is scoped by.
 */
export function orgRoute<B extends Schema | undefined = undefined, Q extends Schema | undefined = undefined>(
  config: BaseConfig<B, Q> & { permission: Permission },
  fn: (args: OrgArgs<B, Q>) => Promise<unknown>,
) {
  return build("org", config, fn);
}
