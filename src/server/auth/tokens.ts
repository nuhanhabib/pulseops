import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque bearer secrets (session tokens, invitation tokens).
 *
 * 256 bits from the OS CSPRNG, so they cannot be guessed, and therefore a fast
 * unsalted hash is the right way to store them: the purpose of the hash is only
 * that a database leak does not hand an attacker working tokens. (Passwords are
 * low-entropy and get argon2id instead; see password.ts.)
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison for two strings of any length. */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

/** Webhook signing secret, shown to the user exactly once. */
export function generateSigningSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/**
 * Signature sent with outbound webhooks. The timestamp is signed together with
 * the body so a captured request cannot be replayed later.
 */
export function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}
