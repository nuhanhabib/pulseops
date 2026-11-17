import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing: argon2id with the OWASP-recommended minimum parameters
 * (19 MiB memory, 2 iterations, 1 lane). The output is a self-describing PHC
 * string, so parameters can be raised later and old hashes still verify.
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed stored hash must read as "wrong password", not as a 500.
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same CPU as a real verification when the account does not exist,
 * so response time does not reveal which email addresses are registered.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("pulseops-timing-equalizer");
  await verifyPassword(await dummyHash, password);
  return false;
}

/** True when a stored hash was produced with weaker parameters than today's. */
export function needsRehash(passwordHash: string): boolean {
  const match = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(passwordHash);
  if (!match) return true;
  const [, memory, time, lanes] = match;
  return (
    Number(memory) < ARGON2_OPTIONS.memoryCost ||
    Number(time) < ARGON2_OPTIONS.timeCost ||
    Number(lanes) < ARGON2_OPTIONS.parallelism
  );
}
