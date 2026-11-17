/**
 * Typed application errors.
 *
 * Services throw these; the HTTP layer turns them into responses. Anything
 * else that reaches the HTTP layer is treated as a bug: logged in full and
 * reported to the client as an opaque 500.
 */
export const ERROR_STATUS = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  csrf_rejected: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  validation_failed: 422,
  rate_limited: 429,
  internal_error: 500,
  upstream_error: 502,
  feature_disabled: 503,
  service_unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface AppErrorOptions {
  fields?: Record<string, string[]>;
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string[]>;
  readonly retryAfterSeconds?: number;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fields = options.fields;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;

export const badRequest = (message: string) => new AppError("bad_request", message);

export const unauthenticated = (message = "Sign in to continue.") => new AppError("unauthenticated", message);

export const forbidden = (message = "You do not have permission to do that.") => new AppError("forbidden", message);

/**
 * Also used when a record exists in *another* organization: a caller must not
 * be able to tell "not yours" apart from "does not exist".
 */
export const notFound = (resource = "Resource") => new AppError("not_found", `${resource} not found.`);

export const conflict = (message: string, fields?: Record<string, string[]>) =>
  new AppError("conflict", message, { fields });

export const validationFailed = (fields: Record<string, string[]>, message = "Some fields need attention.") =>
  new AppError("validation_failed", message, { fields });

/** Convenience for a single-field validation failure raised by a service. */
export const fieldError = (field: string, message: string) => validationFailed({ [field]: [message] }, message);

/** "in 40 seconds" / "in 12 minutes": tells the user how long the limit actually lasts. */
export function describeWait(seconds: number): string {
  if (seconds < 60) return `in ${Math.max(1, Math.round(seconds))} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export const rateLimited = (retryAfterSeconds: number, message = "Too many requests.") =>
  new AppError("rate_limited", `${message.replace(/\s*Try again.*$/, "")} Try again ${describeWait(retryAfterSeconds)}.`, { retryAfterSeconds });

/**
 * The rate-limit store (Redis) could not be reached and this limit fails
 * closed. Reported as what it is, an outage on our side, rather than as the
 * caller having sent too many requests.
 */
export const limiterUnavailable = () =>
  new AppError("service_unavailable", "A required service (Redis) is not reachable, so this request cannot be checked safely. Start Redis, or try again in a moment.", { retryAfterSeconds: 15 });

export const featureDisabled = (message: string) => new AppError("feature_disabled", message);

export const upstreamError = (message: string, cause?: unknown) => new AppError("upstream_error", message, { cause });
