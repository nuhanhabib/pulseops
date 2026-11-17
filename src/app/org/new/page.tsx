import type { Metadata } from "next";

import { AuthFrame } from "@/features/auth/auth-frame";
import { NewOrganizationForm } from "@/features/auth/auth-forms";

export const metadata: Metadata = { title: "New organization" };

export default function NewOrganizationPage() {
  return (
    <AuthFrame title="Create an organization" description="You will be its owner.">
      <NewOrganizationForm />
    </AuthFrame>
  );
}
