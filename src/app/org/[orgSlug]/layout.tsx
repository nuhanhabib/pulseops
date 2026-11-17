import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { AppShell, AppShellSkeleton } from "@/components/layout/app-shell";
import { OrgProvider } from "@/features/org/org-context";
import { RealtimeProvider } from "@/features/realtime/realtime-provider";
import { getPageSession } from "@/server/auth/page";
import { isAiEnabled } from "@/server/env";
import { listMemberships } from "@/server/modules/organizations/service";
import { routes } from "@/shared/routes";

/**
 * The gate for everything under /org/[orgSlug]. The session and membership are
 * resolved on the server before any workspace UI is rendered; pages beneath
 * are client components that talk to the API, which authorizes every call
 * again on its own.
 */
async function OrgGate({ params, children }: { params: Promise<{ orgSlug: string }>; children: React.ReactNode }) {
  const { orgSlug } = await params;
  const session = await getPageSession();
  if (!session) redirect(`${routes.signIn}?next=${encodeURIComponent(routes.org(orgSlug).root)}`);

  const memberships = await listMemberships(session.user.id);
  const current = memberships.find((membership) => membership.organization.slug === orgSlug);
  // Not a member and "does not exist" look identical.
  if (!current) notFound();

  return (
    <OrgProvider
      value={{
        user: { id: session.user.id, name: session.user.name, email: session.user.email },
        organization: current.organization, role: current.role, memberships, aiEnabled: isAiEnabled(),
      }}
    >
      <RealtimeProvider>
        <AppShell>{children}</AppShell>
      </RealtimeProvider>
    </OrgProvider>
  );
}

export default function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ orgSlug: string }> }) {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <OrgGate params={params}>{children}</OrgGate>
    </Suspense>
  );
}
