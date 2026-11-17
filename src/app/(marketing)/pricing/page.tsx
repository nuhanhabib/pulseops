import { Check, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { CallToAction, PageHero } from "@/components/marketing/site-chrome";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { routes } from "@/shared/routes";

export const metadata: Metadata = { title: "Pricing", description: "PulseOps is open source. The plans on this page are illustrative." };

const PLANS = [
  { name: "Self-hosted", price: "Free", note: "MIT licensed. This is the only plan that exists today.", featured: true, cta: "Create an account", items: ["Every feature in the repository", "Unlimited members", "Limits you configure yourself", "Your infrastructure, your data"] },
  { name: "Team", price: "$29", unit: "/ month", note: "Illustrative example of a hosted tier.", cta: null, items: ["50 monitors", "30-second checks", "3 status pages", "Email and webhook notifications"] },
  { name: "Business", price: "$99", unit: "/ month", note: "Illustrative example of a hosted tier.", cta: null, items: ["250 monitors", "Longer data retention", "Unlimited status pages", "Audit log export"] },
];

export default function PricingPage() {
  return (
    <>
      <PageHero eyebrow="Pricing" title="Free to run yourself" description="PulseOps is an open-source project. There is no hosted service and no billing system, so there is nothing to buy." />
      <div className="mx-auto max-w-6xl px-5 py-14">
        <Callout tone="info" icon={Info} title="The paid tiers below are illustrative" className="mb-8">
          They show how plan limits could be presented in this interface. They are not offers: no payment is collected and no such plans can be purchased. The per-organization limits that do exist (maximum monitors, minimum interval) are set by whoever operates the instance.
        </Callout>
        <ul className="grid gap-5 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <li key={plan.name} className={cn("surface-card flex flex-col p-6", plan.featured && "border-brand/50 ring-1 ring-brand/30")}>
              <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{plan.name}</h2>{!plan.featured && <span className="rounded-full border border-border-strong px-2 py-0.5 text-2xs font-medium text-muted">Illustrative</span>}</div>
              <p className="mt-4"><span className="font-display text-4xl font-semibold tracking-tight">{plan.price}</span>{plan.unit && <span className="ml-1 text-sm text-muted">{plan.unit}</span>}</p>
              <p className="mt-1 text-sm text-muted">{plan.note}</p>
              <ul className="mt-6 flex flex-1 flex-col gap-2.5">{plan.items.map((item) => <li key={item} className="flex gap-2.5 text-sm text-text-2"><Check className="mt-0.5 size-4 shrink-0 text-ok-fg" aria-hidden />{item}</li>)}</ul>
              <div className="mt-6">{plan.cta ? <Button asChild variant="primary" className="w-full"><Link href={routes.signUp}>{plan.cta}</Link></Button> : <Button disabled className="w-full">Not available</Button>}</div>
            </li>
          ))}
        </ul>
      </div>
      <CallToAction />
    </>
  );
}
