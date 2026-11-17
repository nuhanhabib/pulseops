import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthFrame } from "@/features/auth/auth-frame";
import { SignUpForm } from "@/features/auth/auth-forms";

export const metadata: Metadata = { title: "Create your account" };

export default function SignUpPage() {
  return (
    <AuthFrame title="Create your account" description="Start monitoring in under a minute. No card, no trial clock.">
      <Suspense fallback={<div className="skeleton h-80" />}><SignUpForm /></Suspense>
    </AuthFrame>
  );
}
