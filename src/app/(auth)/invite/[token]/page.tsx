import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthFrame } from "@/features/auth/auth-frame";
import { InvitationPanel } from "@/features/auth/auth-forms";
import { getPageSession } from "@/server/auth/page";

export const metadata: Metadata = { title: "Accept invitation", robots: { index: false } };

async function Panel({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, session] = await Promise.all([params, getPageSession()]);
  return <InvitationPanel token={token} signedInEmail={session?.user.email ?? null} />;
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <AuthFrame>
      <Suspense fallback={<div className="skeleton h-48" />}><Panel params={params} /></Suspense>
    </AuthFrame>
  );
}
