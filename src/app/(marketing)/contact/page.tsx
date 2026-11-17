import { Bug, LifeBuoy, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";

import { PageHero } from "@/components/marketing/site-chrome";

export const metadata: Metadata = { title: "Contact and support" };

const ROUTES = [
  { icon: Bug, title: "Bugs and feature requests", text: "Open an issue on the project's GitHub repository. Include what you expected, what happened, and the request id from any error response (the X-Request-Id header)." },
  { icon: ShieldAlert, title: "Security reports", text: "Please do not open a public issue for a vulnerability. Follow the private reporting process described in SECURITY.md in the repository." },
  { icon: LifeBuoy, title: "Help with an instance", text: "PulseOps is self-hosted, so each instance is run by its own operator. For access, invitations, or configuration, contact the person or team who runs the instance you are using." },
];

export default function ContactPage() {
  return (
    <>
      <PageHero eyebrow="Contact" title="How to get help" description="PulseOps is an open-source project without a support desk. These are the routes that actually reach someone." />
      <div className="mx-auto max-w-6xl px-5 py-14">
        <ul className="grid gap-5 lg:grid-cols-3">
          {ROUTES.map((route) => (
            <li key={route.title} className="surface-card p-6">
              <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface-2 text-brand-text"><route.icon className="size-4" /></span>
              <h2 className="mt-4 text-md font-semibold">{route.title}</h2>
              <p className="mt-1.5 text-sm text-text-2">{route.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
