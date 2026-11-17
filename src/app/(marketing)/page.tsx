import { Activity, ArrowRight, BarChart3, Bell, Globe, Lock, Radio, ScrollText, ShieldCheck, Siren, Sparkles, Users } from "lucide-react";
import Link from "next/link";

import { ProductPreview } from "@/components/marketing/product-preview";
import { CallToAction, Section } from "@/components/marketing/site-chrome";
import { Button } from "@/components/ui/button";
import { APP_TAGLINE } from "@/shared/constants";
import { routes } from "@/shared/routes";

const FEATURES = [
  { icon: Activity, title: "Uptime and API monitoring", text: "HTTP checks from 30-second intervals, with per-phase timings, expected status codes, retries, and thresholds you set." },
  { icon: Siren, title: "Incident management", text: "Sustained failures open one incident automatically. Assign an owner, post updates, keep internal notes, resolve." },
  { icon: Radio, title: "Live by default", text: "Status changes and incidents reach every open dashboard over a per-organization event stream. No refresh button." },
  { icon: Globe, title: "Public status pages", text: "Choose the components, give them public names, and publish only the updates you mark as public." },
  { icon: BarChart3, title: "Operational analytics", text: "Uptime trends, latency percentiles, incident frequency, and time to resolve, with every formula documented." },
  { icon: Bell, title: "Notifications that arrive once", text: "Email and signed webhooks, delivered through a transactional outbox with retries, deduplication, and a delivery log." },
];

const STEPS = [
  { step: "01", title: "Add a monitor", text: "Paste a URL, pick an interval, and run a test check before saving. The first scheduled result lands within seconds." },
  { step: "02", title: "Let it watch", text: "A dedicated worker runs every check, records the result, and tracks consecutive failures against your thresholds." },
  { step: "03", title: "Respond together", text: "When a monitor goes down, an incident opens, the team is notified, and the timeline starts. When it recovers, it can close itself." },
  { step: "04", title: "Keep customers informed", text: "Publish the incident to a status page with updates written for them, not for your on-call channel." },
];

const ENGINEERING = [
  { icon: ShieldCheck, title: "SSRF-guarded checks", text: "User-supplied URLs are validated, resolved, and pinned to the vetted address, so a monitor cannot be aimed at private networks or metadata endpoints." },
  { icon: Lock, title: "Tenant isolation on the server", text: "Every service call carries an organization context proven by membership. Cross-tenant ids read as “not found”, and tests assert it." },
  { icon: Users, title: "Role-based access", text: "Owner, admin, member, and viewer, enforced from one permission table in the service layer." },
  { icon: ScrollText, title: "Audit trail", text: "Changes to monitors, incidents, members, and settings are recorded with actor and origin, and never contain secrets." },
  { icon: Sparkles, title: "Optional AI assistant", text: "Off unless you configure a key. Works from sanitized aggregates, offers hypotheses, and cannot change anything." },
  { icon: Activity, title: "Postgres is the source of truth", text: "Schedules and pending notifications live in the database. Redis runs the queues; losing it loses nothing durable." },
];

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-border">
        <div className="grid-fade pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-[1fr_1.05fr] lg:py-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-2"><span className="size-1.5 rounded-full bg-ok" />Open source · self-hosted · MIT licensed</p>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl sm:leading-[1.05] lg:text-6xl">Know before it breaks. <span className="text-gradient">Resolve before it matters.</span></h1>
            <p className="mt-5 max-w-xl text-md text-text-2 sm:text-lg">PulseOps monitors your websites and APIs, turns sustained failures into incidents your team can run, and keeps customers informed with a status page you control.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild variant="primary" size="lg"><Link href={routes.signUp}>Start monitoring<ArrowRight /></Link></Button>
              <Button asChild size="lg"><Link href={routes.signIn}>Open the demo workspace</Link></Button>
            </div>
            <p className="mt-4 text-sm text-muted">The demo workspace is seeded sample data plus live checks against a bundled simulator. It is labelled as such throughout.</p>
          </div>
          <ProductPreview />
        </div>
      </section>

      <Section eyebrow="What it does" title="One place for the whole outage, from first failed check to public postmortem" description="Monitoring tools tell you something is wrong. PulseOps carries on from there.">
        <ul className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="bg-surface p-6">
              <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface-2 text-brand-text"><feature.icon className="size-4" /></span>
              <h3 className="mt-4 text-md font-semibold">{feature.title}</h3>
              <p className="mt-1.5 text-sm text-text-2">{feature.text}</p>
            </li>
          ))}
        </ul>
        <div className="mt-6"><Button asChild variant="link"><Link href={routes.features}>See every feature<ArrowRight /></Link></Button></div>
      </Section>

      <div className="border-y border-border bg-surface">
        <Section eyebrow="How it works" title="From URL to resolution in four steps">
          <ol className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((item) => (
              <li key={item.step}>
                <p className="font-mono text-sm text-brand-text">{item.step}</p>
                <h3 className="mt-2 text-md font-semibold">{item.title}</h3>
                <p className="mt-1.5 text-sm text-text-2">{item.text}</p>
              </li>
            ))}
          </ol>
        </Section>
      </div>

      <Section eyebrow="How it is built" title="Engineering you can read, not claims you have to trust" description="There are no customer logos or compliance badges here, because this is an open project. What it has instead is source code, tests, and documented decisions.">
        <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {ENGINEERING.map((item) => (
            <li key={item.title} className="flex gap-3.5">
              <item.icon className="mt-0.5 size-5 shrink-0 text-brand-text" />
              <div><h3 className="text-base font-semibold">{item.title}</h3><p className="mt-1 text-sm text-text-2">{item.text}</p></div>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-sm text-muted">{APP_TAGLINE} Built with Next.js, TypeScript, PostgreSQL, Prisma, Redis, and BullMQ.</p>
      </Section>
      <CallToAction />
    </>
  );
}
