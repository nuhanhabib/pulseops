import { createSession } from "@/server/auth/sessions";
import { prisma } from "@/server/db";
import type { OrgContext } from "@/server/tenancy";
import { SESSION_COOKIE } from "@/shared/constants";
import type { OrgRole } from "@/shared/enums";

// A placeholder in PHC format. Tests that exercise passwords register through the API instead.
const PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Ln0b3VJ8Vd0y1D6mQ0u0mYQyI3hQe8l7x2sQ1mQ5t3U";
let counter = 0;

export async function createUser(name = "Test User") {
  counter += 1;
  return prisma.user.create({ data: { email: `user${counter}-${Date.now()}@test.example`, name, passwordHash: PASSWORD_HASH } });
}

export async function createOrg(name: string, ownerId: string) {
  counter += 1;
  return prisma.organization.create({
    data: { name, slug: `org-${counter}-${Date.now()}`, members: { create: { userId: ownerId, role: "OWNER" } } },
  });
}

export async function addMember(organizationId: string, userId: string, role: OrgRole) {
  return prisma.organizationMember.create({ data: { organizationId, userId, role } });
}

/** A tenant with an owner, ready to use. */
export async function createTenant(name = "Acme") {
  const user = await createUser(`${name} Owner`);
  const org = await createOrg(name, user.id);
  return { user, org, cookie: await cookieFor(user.id) };
}

export async function cookieFor(userId: string): Promise<string> {
  const session = await createSession(userId);
  return `${SESSION_COOKIE}=${session.token}`;
}

export async function contextFor(userId: string, orgSlug: string): Promise<OrgContext> {
  const { resolveOrgContext } = await import("@/server/tenancy");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return resolveOrgContext({ userId: user.id, email: user.email, name: user.name }, orgSlug);
}

export async function createMonitor(organizationId: string, overrides: Record<string, unknown> = {}) {
  counter += 1;
  return prisma.monitor.create({
    data: { organizationId, name: `Monitor ${counter}`, url: "https://example.com/health", status: "UP", failureThreshold: 3, recoveryThreshold: 2, ...overrides },
  });
}

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** Calls a route handler the way Next.js would, without starting a server. */
export async function call(handler: Handler, options: { method?: string; path?: string; params?: Record<string, string>; cookie?: string; body?: unknown; origin?: string | null; headers?: Record<string, string> } = {}) {
  const method = options.method ?? "GET";
  const headers = new Headers({ host: "localhost:3000", "x-forwarded-for": "198.51.100.7", ...options.headers });
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  // Browsers send Origin on writes; default to same-origin so tests exercise the normal path.
  if (method !== "GET" && options.origin !== null) headers.set("origin", options.origin ?? "http://localhost:3000");
  const response = await handler(
    new Request(`http://localhost:3000${options.path ?? "/api/test"}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }),
    { params: Promise.resolve(options.params ?? {}) },
  );
  const text = await response.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = text ? JSON.parse(text) : null;
  return { status: response.status, json, headers: response.headers };
}
