import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthFrame } from "@/features/auth/auth-frame";
import { SignInForm } from "@/features/auth/auth-forms";
import { prisma } from "@/server/db";

export const metadata: Metadata = { title: "Sign in" };

/** The demo shortcut is offered only when a demo workspace actually exists. */
async function Form() {
  const demo = await prisma.organization.count({ where: { isDemo: true } }).then((count) => count > 0, () => false);
  return <SignInForm demo={demo} />;
}

export default function SignInPage() {
  return (
    <AuthFrame title="Welcome back" description="Sign in to your PulseOps workspace.">
      <Suspense fallback={<div className="skeleton h-64" />}><Form /></Suspense>
    </AuthFrame>
  );
}
