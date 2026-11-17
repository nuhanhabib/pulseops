import { ArrowRight, Database, Globe, MonitorSmartphone, Radio, Server, Workflow } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ProductPreview } from "@/components/marketing/product-preview";
import { CallToAction, PageHero, Section } from "@/components/marketing/site-chrome";
import { Button } from "@/components/ui/button";
import { routes } from "@/shared/routes";

export const metadata: Metadata = { title: "Product overview", description: "How PulseOps is put together and how teams use it." };

const FLOWS = [
  { title: "Create a monitor", path: ["Monitors", "New monitor", "Configure", "Run test", "Save", "First result in seconds"] },
  { title: "Investigate an outage", path: ["Alert", "Incident", "Monitoring evidence", "Timeline", "Assign owner", "Resolve"] },
  { title: "Publish a status page", path: ["Status pages", "New", "Pick components", "Name them publicly", "Publish", "Share the link"] },
];

const PARTS = [
  { icon: MonitorSmartphone, title: "Web app", text: "Next.js serves the interface, the REST API, and the live event stream. It never runs scheduled checks itself." },
  { icon: Workflow, title: "Worker", text: "A separate, always-on process claims due monitors, executes checks, runs the outage state machine, and delivers notifications." },
  { icon: Database, title: "PostgreSQL", text: "The source of truth: schedules, results, incidents, the notification outbox, and the audit log." },
  { icon: Server, title: "Redis", text: "The execution plane: BullMQ queues, pub/sub for live updates, and rate-limit counters. Nothing durable lives only here." },
  { icon: Radio, title: "Event stream", text: "Server-Sent Events per organization. Events say what changed; the browser refetches through the authorized API." },
  { icon: Globe, title: "Public pages", text: "Status pages are rendered from a separate, allowlisted query that cannot reach private fields." },
];

export default function ProductPage() {
  return (
    <>
      <PageHero eyebrow="Product overview" title="Monitoring, incident response, and status communication in one system" description="PulseOps is a multi-tenant platform: each organization has its own monitors, incidents, members, and status pages, isolated on the server." />
      <Section eyebrow="The interface" title="Dense where it helps, quiet everywhere else" description="A dark-first interface built on one token system, with a light theme, keyboard navigation, a command palette, and layouts that adapt down to a phone.">
        <div className="mx-auto max-w-3xl"><ProductPreview /></div>
      </Section>
      <div className="border-y border-border bg-surface">
        <Section eyebrow="Workflows" title="Designed around what people actually come to do">
          <div className="flex flex-col gap-8">
            {FLOWS.map((flow) => (
              <div key={flow.title}>
                <h3 className="text-md font-semibold">{flow.title}</h3>
                <ol className="mt-3 flex flex-wrap items-center gap-2">
                  {flow.path.map((step, index) => (
                    <li key={step} className="flex items-center gap-2 text-sm">
                      <span className="rounded-md border border-border bg-bg px-2.5 py-1 text-text-2">{step}</span>
                      {index < flow.path.length - 1 && <ArrowRight className="size-3.5 text-faint" aria-hidden />}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </Section>
      </div>
      <Section eyebrow="Architecture" title="Three processes, two stores, one source of truth" description="The monitoring worker runs independently and continuously. It is not a serverless cron job, and the design does not pretend otherwise.">
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PARTS.map((part) => (
            <li key={part.title} className="surface-card p-5">
              <part.icon className="size-5 text-brand-text" />
              <h3 className="mt-3 text-md font-semibold">{part.title}</h3>
              <p className="mt-1.5 text-sm text-text-2">{part.text}</p>
            </li>
          ))}
        </ul>
        <div className="mt-8"><Button asChild variant="link"><Link href={routes.docs}>Read the architecture notes<ArrowRight /></Link></Button></div>
      </Section>
      <CallToAction />
    </>
  );
}
