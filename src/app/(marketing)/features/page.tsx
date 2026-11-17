import { Check } from "lucide-react";
import type { Metadata } from "next";

import { CallToAction, PageHero } from "@/components/marketing/site-chrome";

export const metadata: Metadata = { title: "Features", description: "Everything PulseOps does, stated precisely." };

const GROUPS = [
  { title: "Monitoring", intro: "A dedicated worker runs real HTTP requests on a schedule Postgres owns.", items: [
    "GET, HEAD, POST, and OPTIONS checks at intervals from 30 seconds to 1 hour",
    "Per-check timeout, in-check retries, and expected status codes or ranges",
    "DNS, connect, TLS, and time-to-first-byte recorded for every check",
    "Failure classification: timeout, DNS, TLS, connection, unexpected status, redirect, blocked by policy",
    "Failure and recovery thresholds, so one blip never pages anyone",
    "A “degraded” state for endpoints that answer correctly but slowly",
    "Pause, resume, run a check now, and test a configuration before saving",
  ] },
  { title: "Incidents", intro: "Opened by monitoring or declared by a person, run in one timeline.", items: [
    "Automatic incidents when a monitor crosses its failure threshold, with no duplicates while it stays down",
    "Automatic resolution on recovery, which you can turn off per organization",
    "Four statuses (investigating, identified, monitoring, resolved) and four severities",
    "Owner assignment, linked monitors, timeline updates, and internal notes",
    "Search and filter by state, severity, owner, and incident number",
    "Field-level activity history for every incident",
  ] },
  { title: "Visibility", intro: "For the team in the moment, and for the review afterwards.", items: [
    "A live dashboard: status counts, uptime, latency, incidents, and recent events",
    "Per-monitor pages with a 90-day availability strip, outage list, failure heatmap, and check history",
    "Analytics across 24 hours to 90 days, compared against the previous period",
    "Every chart has a table view, a legend where it needs one, and no dual axes",
    "Real-time updates over Server-Sent Events, scoped to your organization",
  ] },
  { title: "Communication", intro: "Tell the right people, once.", items: [
    "Public status pages with public component names, uptime history, and incident notices",
    "Only incidents and updates you explicitly publish ever appear publicly",
    "Email notifications over SMTP, and webhooks signed with HMAC-SHA256",
    "Per-member preferences and shared channels, each subscribed to the events it wants",
    "Retries with backoff, deduplication, an hourly ceiling per destination, and a delivery log",
  ] },
  { title: "Security and administration", intro: "Multi-tenant from the first table.", items: [
    "Organizations with owner, admin, member, and viewer roles",
    "Single-use, email-bound invitation links",
    "Server-side sessions you can revoke per device; argon2id password hashing",
    "SSRF protection on every outbound request the platform makes for you",
    "An append-only audit log of configuration and membership changes",
    "Rate limiting on sign-in, sign-up, writes, test checks, and public pages",
  ] },
  { title: "AI incident assistant (optional)", intro: "Disabled unless an operator configures an API key.", items: [
    "Summary, ranked hypotheses with reasoning, troubleshooting steps, and a draft customer update",
    "Works from sanitized aggregates: no URLs, hostnames, notes, or member data are sent",
    "Clearly labelled as AI-generated; cannot modify monitors, incidents, or status pages",
    "Rate limited per organization, with a hard cap on output tokens",
  ] },
];

export default function FeaturesPage() {
  return (
    <>
      <PageHero eyebrow="Features" title="What PulseOps does, without the adjectives" description="Each line below is implemented and covered by the test suite or verifiable in the demo workspace. Where something is not supported, the documentation says so." />
      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-x-12 gap-y-14 lg:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title} aria-labelledby={group.title}>
              <h2 id={group.title} className="text-xl font-semibold tracking-tight">{group.title}</h2>
              <p className="mt-1.5 text-sm text-muted">{group.intro}</p>
              <ul className="mt-5 flex flex-col gap-3">
                {group.items.map((item) => <li key={item} className="flex gap-3 text-sm text-text-2"><Check className="mt-0.5 size-4 shrink-0 text-ok-fg" aria-hidden />{item}</li>)}
              </ul>
            </section>
          ))}
        </div>
        <section className="mt-16 rounded-2xl border border-border bg-surface p-6 sm:p-8" aria-labelledby="not-included">
          <h2 id="not-included" className="text-lg font-semibold">Not included</h2>
          <p className="mt-2 max-w-3xl text-sm text-text-2">To be clear about scope: checks run from one location, not several regions. Monitors cannot send custom headers or request bodies yet. There are no Slack, Discord, SMS, or paging integrations; webhooks are the bridge to those. There is no billing system, single sign-on, or email verification.</p>
        </section>
      </div>
      <CallToAction />
    </>
  );
}
