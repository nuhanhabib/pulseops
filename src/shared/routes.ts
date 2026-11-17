/** Every in-app URL is built here, so a route rename is a one-file change. */

export const routes = {
  home: "/",
  features: "/features",
  product: "/product",
  pricing: "/pricing",
  docs: "/docs",
  doc: (slug: string) => `/docs/${slug}`,
  contact: "/contact",
  signIn: "/sign-in",
  signUp: "/sign-up",
  /** Resolves to the signed-in user's last (or first) organization. */
  app: "/org",
  newOrganization: "/org/new",
  invite: (token: string) => `/invite/${token}`,
  statusPage: (slug: string) => `/status/${slug}`,
  org: (orgSlug: string) => {
    const base = `/org/${orgSlug}`;
    return {
      root: base,
      dashboard: `${base}/dashboard`,
      monitors: `${base}/monitors`,
      newMonitor: `${base}/monitors/new`,
      monitor: (monitorId: string) => `${base}/monitors/${monitorId}`,
      editMonitor: (monitorId: string) => `${base}/monitors/${monitorId}/edit`,
      incidents: `${base}/incidents`,
      incident: (incidentId: string) => `${base}/incidents/${incidentId}`,
      analytics: `${base}/analytics`,
      statusPages: `${base}/status-pages`,
      statusPageEditor: (statusPageId: string) => `${base}/status-pages/${statusPageId}`,
      auditLog: `${base}/audit-log`,
      settings: `${base}/settings`,
      settingsMembers: `${base}/settings/members`,
      settingsNotifications: `${base}/settings/notifications`,
      settingsAi: `${base}/settings/ai`,
      settingsProfile: `${base}/settings/profile`,
    };
  },
} as const;

export type OrgRoutes = ReturnType<typeof routes.org>;

export const apiRoutes = {
  org: (orgSlug: string) => `/api/v1/orgs/${orgSlug}`,
} as const;

/**
 * Only same-origin, path-only targets are accepted for post-login redirects.
 * Rejects absolute URLs, protocol-relative URLs, and backslash tricks that
 * browsers normalize into another origin.
 */
export function safeRedirectPath(target: string | null | undefined, fallback: string = routes.app): string {
  if (!target) return fallback;
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(target)) return fallback;
  try {
    const url = new URL(target, "http://internal.invalid");
    if (url.origin !== "http://internal.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
