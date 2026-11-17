import { describe, expect, it } from "vitest";

import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as changePassword } from "@/app/api/v1/me/password/route";
import { GET as me } from "@/app/api/v1/me/route";
import { GET as auditLog } from "@/app/api/v1/orgs/[orgSlug]/audit-log/route";
import { GET as dashboard } from "@/app/api/v1/orgs/[orgSlug]/dashboard/route";
import { DELETE as deleteIncident, GET as getIncident } from "@/app/api/v1/orgs/[orgSlug]/incidents/[incidentId]/route";
import { POST as createIncidentRoute } from "@/app/api/v1/orgs/[orgSlug]/incidents/route";
import { PATCH as patchMember } from "@/app/api/v1/orgs/[orgSlug]/members/[memberId]/route";
import { DELETE as deleteMonitor, GET as getMonitor, PATCH as patchMonitor } from "@/app/api/v1/orgs/[orgSlug]/monitors/[monitorId]/route";
import { GET as listMonitors, POST as createMonitorRoute } from "@/app/api/v1/orgs/[orgSlug]/monitors/route";
import { GET as search } from "@/app/api/v1/orgs/[orgSlug]/search/route";
import { prisma } from "@/server/db";

import { addMember, call, cookieFor, createMonitor, createTenant, createUser } from "../helpers/factories";

const account = { name: "Ada Lovelace", email: "ada@test.example", password: "analytical-engine-1843", organizationName: "Analytical" };
const sessionCookie = (headers: Headers) => (headers.get("set-cookie") ?? "").split(";")[0] ?? "";

describe("authentication", () => {
  it("registers, creates an owned organization, and sets a hardened session cookie", async () => {
    const response = await call(register, { method: "POST", body: account });
    expect(response.status).toBe(201);
    expect(response.json.data.orgSlug).toBe("analytical");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: account.email }, include: { memberships: true, sessions: true } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.memberships[0]?.role).toBe("OWNER");
    // Only a hash of the token is stored.
    expect(cookie).not.toContain(user.sessions[0]?.tokenHash);
    expect(JSON.stringify(response.json)).not.toContain("passwordHash");
  });

  it("rejects a duplicate email and a weak password", async () => {
    await call(register, { method: "POST", body: account });
    expect((await call(register, { method: "POST", body: account })).status).toBe(409);
    const weak = await call(register, { method: "POST", body: { ...account, email: "b@test.example", password: "short" } });
    expect(weak.status).toBe(422);
    expect(weak.json.error.fields.password).toBeDefined();
  });

  it("signs in, and gives the same error for a wrong password and an unknown account", async () => {
    await call(register, { method: "POST", body: account });
    const good = await call(login, { method: "POST", body: { email: "ADA@test.example", password: account.password } });
    expect(good.status).toBe(200);
    const wrong = await call(login, { method: "POST", body: { email: account.email, password: "not-the-password-1" } });
    const unknown = await call(login, { method: "POST", body: { email: "nobody@test.example", password: "not-the-password-1" } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json.error.message).toBe(unknown.json.error.message);
  });

  it("locks out repeated failed sign-ins for an account", async () => {
    await call(register, { method: "POST", body: account });
    let last = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      last = (await call(login, { method: "POST", body: { email: account.email, password: "wrong-password-1" } })).status;
    }
    expect(last).toBe(429);
    // Even the right password is refused while locked out.
    expect((await call(login, { method: "POST", body: { email: account.email, password: account.password } })).status).toBe(429);
  });

  it("requires a session, and signing out revokes it on the server", async () => {
    expect((await call(me)).status).toBe(401);
    expect((await call(me, { cookie: "pulseops_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).status).toBe(401);
    const cookie = sessionCookie((await call(register, { method: "POST", body: account })).headers);
    expect((await call(me, { cookie })).json.data.user.email).toBe(account.email);
    expect((await call(logout, { method: "POST", cookie })).status).toBe(204);
    // The old cookie is now worthless, which a signed stateless token could not guarantee.
    expect((await call(me, { cookie })).status).toBe(401);
  });

  it("changing the password signs out other devices", async () => {
    const first = sessionCookie((await call(register, { method: "POST", body: account })).headers);
    const second = sessionCookie((await call(login, { method: "POST", body: { email: account.email, password: account.password } })).headers);
    const wrong = await call(changePassword, { method: "POST", cookie: first, body: { currentPassword: "nope-nope-nope-1", newPassword: "a-brand-new-secret-7" } });
    expect(wrong.status).toBe(422);
    const changed = await call(changePassword, { method: "POST", cookie: first, body: { currentPassword: account.password, newPassword: "a-brand-new-secret-7" } });
    expect(changed.json.data.revokedSessions).toBe(1);
    expect((await call(me, { cookie: first })).status).toBe(200);
    expect((await call(me, { cookie: second })).status).toBe(401);
  });

  it("rejects cross-site writes (CSRF)", async () => {
    const { org, cookie } = await createTenant();
    const forged = await call(createMonitorRoute, { method: "POST", cookie, origin: "https://evil.example", params: { orgSlug: org.slug }, body: { name: "x", url: "https://example.com" } });
    expect(forged.status).toBe(403);
    expect(forged.json.error.code).toBe("csrf_rejected");
    expect(await prisma.monitor.count()).toBe(0);
  });
});

describe("tenant isolation", () => {
  it("never exposes another organization's records, by slug or by id", async () => {
    const acme = await createTenant("Acme");
    const globex = await createTenant("Globex");
    const secret = await createMonitor(globex.org.id, { name: "Globex Secret API", url: "https://secret.globex.example/health" });
    const incident = await prisma.incident.create({ data: { organizationId: globex.org.id, number: 1, title: "Globex confidential outage" } });

    // Another organization's slug is "not found", not "forbidden": its existence is not confirmed.
    for (const handler of [listMonitors, dashboard, auditLog, search]) {
      expect((await call(handler, { cookie: acme.cookie, params: { orgSlug: globex.org.slug }, path: "/api/x?q=Globex" })).status).toBe(404);
    }

    // A foreign id under the caller's own organization is also "not found", for reads and writes alike.
    const own = { orgSlug: acme.org.slug };
    expect((await call(getMonitor, { cookie: acme.cookie, params: { ...own, monitorId: secret.id } })).status).toBe(404);
    expect((await call(patchMonitor, { method: "PATCH", cookie: acme.cookie, params: { ...own, monitorId: secret.id }, body: { name: "pwned" } })).status).toBe(404);
    expect((await call(deleteMonitor, { method: "DELETE", cookie: acme.cookie, params: { ...own, monitorId: secret.id } })).status).toBe(404);
    expect((await call(getIncident, { cookie: acme.cookie, params: { ...own, incidentId: incident.id } })).status).toBe(404);
    expect((await call(deleteIncident, { method: "DELETE", cookie: acme.cookie, params: { ...own, incidentId: incident.id } })).status).toBe(404);

    // Linking a foreign monitor to one's own incident is refused.
    const link = await call(createIncidentRoute, { method: "POST", cookie: acme.cookie, params: own, body: { title: "Probe attempt", monitorIds: [secret.id] } });
    expect(link.status).toBe(422);

    // Lists and search return nothing from the other tenant.
    const list = await call(listMonitors, { cookie: acme.cookie, params: own });
    expect(list.json.data.items).toEqual([]);
    const found = await call(search, { cookie: acme.cookie, params: own, path: "/api/x?q=Globex" });
    expect(JSON.stringify(found.json)).not.toContain("Globex");

    // And the foreign records are untouched.
    expect((await prisma.monitor.findUniqueOrThrow({ where: { id: secret.id } })).name).toBe("Globex Secret API");
    expect(await prisma.incident.count({ where: { id: incident.id } })).toBe(1);
  });
});

describe("role enforcement", () => {
  it("applies the permission table on the server", async () => {
    const { org, user: owner, cookie: ownerCookie } = await createTenant();
    const [viewer, member, admin] = await Promise.all([createUser("Viewer"), createUser("Member"), createUser("Admin")]);
    await addMember(org.id, viewer.id, "VIEWER");
    await addMember(org.id, member.id, "MEMBER");
    const adminMembership = await addMember(org.id, admin.id, "ADMIN");
    const cookies = { viewer: await cookieFor(viewer.id), member: await cookieFor(member.id), admin: await cookieFor(admin.id) };
    const params = { orgSlug: org.slug };
    const body = { name: "Health", url: "https://93.184.216.34/health" };

    // Viewers read but cannot write.
    expect((await call(listMonitors, { cookie: cookies.viewer, params })).status).toBe(200);
    expect((await call(createMonitorRoute, { method: "POST", cookie: cookies.viewer, params, body })).status).toBe(403);

    // Members create and edit, but cannot delete or read the audit log.
    const created = await call(createMonitorRoute, { method: "POST", cookie: cookies.member, params, body });
    expect(created.status).toBe(201);
    const monitorId = created.json.data.id;
    expect((await call(deleteMonitor, { method: "DELETE", cookie: cookies.member, params: { ...params, monitorId } })).status).toBe(403);
    expect((await call(auditLog, { cookie: cookies.member, params })).status).toBe(403);

    // Admins can do both, and the actions are audited.
    expect((await call(deleteMonitor, { method: "DELETE", cookie: cookies.admin, params: { ...params, monitorId } })).status).toBe(204);
    const log = await call(auditLog, { cookie: cookies.admin, params });
    expect(log.json.data.items.map((entry: { action: string }) => entry.action)).toEqual(expect.arrayContaining(["monitor.created", "monitor.deleted"]));

    // Admins cannot touch owners or grant ownership, and the last owner cannot be demoted.
    const ownerMembership = await prisma.organizationMember.findFirstOrThrow({ where: { organizationId: org.id, userId: owner.id } });
    expect((await call(patchMember, { method: "PATCH", cookie: cookies.admin, params: { ...params, memberId: ownerMembership.id }, body: { role: "MEMBER" } })).status).toBe(403);
    expect((await call(patchMember, { method: "PATCH", cookie: cookies.admin, params: { ...params, memberId: adminMembership.id }, body: { role: "OWNER" } })).status).toBe(403);
    expect((await call(patchMember, { method: "PATCH", cookie: ownerCookie, params: { ...params, memberId: ownerMembership.id }, body: { role: "ADMIN" } })).status).toBe(409);
  });
});

describe("monitor validation through the API", () => {
  it("rejects private targets and malformed input with field errors", async () => {
    const { org, cookie } = await createTenant();
    const params = { orgSlug: org.slug };
    for (const url of ["http://169.254.169.254/latest/meta-data/", "http://localhost:5432", "http://10.0.0.1/admin", "http://[::1]/"]) {
      const response = await call(createMonitorRoute, { method: "POST", cookie, params, body: { name: `m ${url}`, url } });
      expect(response.status, url).toBe(422);
      expect(response.json.error.fields.url, url).toBeDefined();
    }
    const bad = await call(createMonitorRoute, { method: "POST", cookie, params, body: { name: "", url: "nope", intervalSeconds: 5, expectedStatusCodes: "abc" } });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.json.error.fields)).toEqual(expect.arrayContaining(["name", "url", "intervalSeconds", "expectedStatusCodes"]));
    expect(await prisma.monitor.count()).toBe(0);

    const ok = await call(createMonitorRoute, { method: "POST", cookie, params, body: { name: "Health", url: "https://93.184.216.34/health" } });
    expect(ok.status).toBe(201);
    expect((await call(createMonitorRoute, { method: "POST", cookie, params, body: { name: "Health", url: "https://93.184.216.34/other" } })).status).toBe(409);
  });
});
