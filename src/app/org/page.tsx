import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppShellSkeleton } from "@/components/layout/app-shell";
import { getPageSession } from "@/server/auth/page";
import { listMemberships } from "@/server/modules/organizations/service";
import { LAST_ORG_COOKIE } from "@/shared/constants";
import { routes } from "@/shared/routes";

/** /org → the workspace the user last opened, or their first, or onboarding. */
async function Resolve(): Promise<never> {
  const session = await getPageSession();
  if (!session) redirect(routes.signIn);
  const memberships = await listMemberships(session.user.id);
  if (memberships.length === 0) redirect(routes.newOrganization);
  const last = (await cookies()).get(LAST_ORG_COOKIE)?.value;
  const target = memberships.find((membership) => membership.organization.slug === last) ?? memberships[0]!;
  redirect(routes.org(target.organization.slug).dashboard);
}

export default function OrgResolver() {
  return <Suspense fallback={<AppShellSkeleton />}><Resolve /></Suspense>;
}
