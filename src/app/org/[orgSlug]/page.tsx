import { redirect } from "next/navigation";
import { Suspense } from "react";

import { routes } from "@/shared/routes";

async function Go({ params }: { params: Promise<{ orgSlug: string }> }): Promise<never> {
  redirect(routes.org((await params).orgSlug).dashboard);
}

export default function OrgIndex({ params }: { params: Promise<{ orgSlug: string }> }) {
  return <Suspense><Go params={params} /></Suspense>;
}
