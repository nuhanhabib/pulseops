import { limiterUnavailable, rateLimited } from "./errors";
import { logger, serializeError } from "./logger";
import { getRedis, redisKey } from "./redis";

/**
 * Fixed-window rate limiting backed by Redis.
 *
 * INCR and the first-hit expiry run in one Lua script so two concurrent
 * requests can never both see "count = 1" and leave a key without a TTL.
 */
const INCREMENT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { current, ttl }
`;

export interface RateLimitRule {
  /** Namespaces the counter, e.g. "login:ip". */
  bucket: string;
  limit: number;
  windowSeconds: number;
  /**
   * What to do when Redis is unreachable. Most limits fail open so a cache
   * outage does not take the product down; limits that guard spend or
   * credentials fail closed.
   */
  onStoreFailure?: "allow" | "deny";
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  /** True when Redis could not be reached. `allowed` then reflects the rule's failure policy, not real usage. */
  storeUnavailable?: boolean;
}

export async function checkRateLimit(rule: RateLimitRule, identifier: string): Promise<RateLimitResult> {
  const key = redisKey("rl", rule.bucket, identifier);
  try {
    const [count, ttlMs] = (await getRedis().eval(INCREMENT_SCRIPT, 1, key, rule.windowSeconds * 1000)) as [number, number];
    const allowed = count <= rule.limit;
    return {
      allowed,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(ttlMs / 1000)),
    };
  } catch (error) {
    const deny = rule.onStoreFailure === "deny";
    logger.warn({ bucket: rule.bucket, deny, err: serializeError(error) }, "rate limit store unavailable");
    return { allowed: !deny, limit: rule.limit, remaining: deny ? 0 : rule.limit, retryAfterSeconds: deny ? 15 : 0, storeUnavailable: true };
  }
}

/** Throws a 429 `AppError` when the limit is exceeded. */
export async function enforceRateLimit(rule: RateLimitRule, identifier: string, message?: string): Promise<RateLimitResult> {
  const result = await checkRateLimit(rule, identifier);
  if (!result.allowed) throw result.storeUnavailable ? limiterUnavailable() : rateLimited(result.retryAfterSeconds, message);
  return result;
}

/** Clears a counter, e.g. the failed-login count after a successful sign-in. */
export async function resetRateLimit(rule: Pick<RateLimitRule, "bucket">, identifier: string): Promise<void> {
  try {
    await getRedis().del(redisKey("rl", rule.bucket, identifier));
  } catch {
    // Best effort: the key expires on its own.
  }
}

export const RATE_LIMITS = {
  /** Credential stuffing from one address across many accounts. */
  loginByIp: { bucket: "login:ip", limit: 20, windowSeconds: 15 * 60, onStoreFailure: "deny" },
  /** Password guessing against one account from many addresses. */
  loginByAccount: { bucket: "login:account", limit: 8, windowSeconds: 15 * 60, onStoreFailure: "deny" },
  registerByIp: { bucket: "register:ip", limit: 20, windowSeconds: 60 * 60, onStoreFailure: "deny" },
  passwordChange: { bucket: "password:user", limit: 5, windowSeconds: 15 * 60, onStoreFailure: "deny" },
  invitationLookup: { bucket: "invite:ip", limit: 30, windowSeconds: 15 * 60 },
  /** Ceiling on writes per user, to contain a runaway script. */
  mutations: { bucket: "mutations:user", limit: 240, windowSeconds: 60 },
  /** Test checks open outbound connections, so they are metered tightly. */
  monitorTest: { bucket: "monitor-test:user", limit: 12, windowSeconds: 60, onStoreFailure: "deny" },
  invitationsSent: { bucket: "invites:org", limit: 30, windowSeconds: 60 * 60 },
  publicStatus: { bucket: "status:ip", limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;
