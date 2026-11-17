import { Activity, Globe, ShieldCheck, Siren } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/ui/logo";
import { APP_TAGLINE } from "@/shared/constants";

const POINTS = [
  { icon: Activity, title: "Real checks, every 30 seconds", text: "DNS, TLS, and response timings recorded for every request." },
  { icon: Siren, title: "Incidents that open themselves", text: "Sustained failures open one incident, never a storm of duplicates." },
  { icon: Globe, title: "Status pages you control", text: "Publish only the components and updates you choose." },
  { icon: ShieldCheck, title: "Isolated by design", text: "Every query is scoped to your organization on the server." },
];

/** Shared two-column frame for sign-in, sign-up, invitations, and onboarding. */
export function AuthFrame({ title, description, children }: { title?: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex flex-col px-6 py-8 sm:px-10">
        <Link href="/" aria-label="PulseOps home"><Logo /></Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          {title && <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>}
          {description && <p className="mt-1.5 mb-6 text-sm text-muted">{description}</p>}
          {children}
        </div>
      </main>
      <aside className="relative hidden overflow-hidden border-l border-border bg-surface lg:flex lg:flex-col lg:justify-center lg:px-14">
        <div className="grid-fade pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="relative max-w-md">
          <p className="font-display text-3xl leading-tight font-semibold tracking-tight">{APP_TAGLINE}</p>
          <ul className="mt-10 flex flex-col gap-6">
            {POINTS.map((point) => (
              <li key={point.title} className="flex gap-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-brand-text"><point.icon className="size-4" /></span>
                <span><span className="block text-base font-medium">{point.title}</span><span className="block text-sm text-muted">{point.text}</span></span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
