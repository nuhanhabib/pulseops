import { BookOpen, Boxes, Database, FileCode2, Gauge, Rocket, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";

import { PageHero, Section } from "@/components/marketing/site-chrome";

export const metadata: Metadata = { title: "Documentation", description: "Quickstart and a guide to the documentation in the repository." };

const GUIDES = [
  { icon: Boxes, title: "Architecture", file: "docs/architecture.md", text: "Processes, data flow, the scheduling and outbox designs, and a diagram." },
  { icon: Database, title: "Database", file: "docs/database.md", text: "Every table, the reasoning behind keys and indexes, and deletion behaviour." },
  { icon: FileCode2, title: "API reference", file: "docs/api.md", text: "Conventions, error codes, and example requests and responses for each endpoint." },
  { icon: Gauge, title: "Metrics", file: "docs/metrics.md", text: "Exactly how uptime, percentiles, downtime, and time to resolve are calculated." },
  { icon: ShieldCheck, title: "Security", file: "docs/security.md", text: "The threat model, the SSRF guard and its limits, sessions, and tenant isolation." },
  { icon: Rocket, title: "Deployment", file: "docs/deployment.md", text: "Running the web app, the worker, Postgres, and Redis in production." },
  { icon: BookOpen, title: "Decision records", file: "docs/decisions/", text: "Short records of the choices that shaped the system, and what was rejected." },
];

const STEPS = [
  { title: "Start the stack", code: "cp .env.example .env\ndocker compose up --build", note: "Starts Postgres, Redis, the web app, the worker, a mail catcher, and the demo target simulator. Migrations and the demo seed run automatically." },
  { title: "Sign in to the demo workspace", code: "http://localhost:3000/sign-in\n\ndemo@northwind.example\npulseops-demo-2026", note: "A seeded organization with ten monitors, three months of history, incidents, and a published status page. All of it is labelled as sample data." },
  { title: "Cause an outage", code: "npm run demo:ctl -- break checkout-api 3", note: "The simulator fails that service for three minutes. Watch the monitor go down, an incident open, notifications arrive in the mail catcher, and everything recover." },
];

export default function DocsPage() {
  return (
    <>
      <PageHero eyebrow="Documentation" title="Run it locally in three steps" description="The full documentation lives in the repository as Markdown, next to the code it describes. This page is the quickstart and a map." />
      <Section title="Quickstart" description="Requires Docker. A manual setup without Docker is described in the README.">
        <ol className="flex flex-col gap-6">
          {STEPS.map((step, index) => (
            <li key={step.title} className="grid gap-4 md:grid-cols-[2rem_1fr]">
              <span className="flex size-8 items-center justify-center rounded-full border border-border bg-surface font-mono text-sm text-brand-text">{index + 1}</span>
              <div className="min-w-0">
                <h3 className="text-md font-semibold">{step.title}</h3>
                <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-xs leading-5 text-text-2"><code>{step.code}</code></pre>
                <p className="mt-2 text-sm text-muted">{step.note}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>
      <div className="border-t border-border bg-surface">
        <Section title="In the repository" description="Each guide is a file you can read on GitHub or in your editor.">
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {GUIDES.map((guide) => (
              <li key={guide.file} className="rounded-xl border border-border bg-bg p-5">
                <guide.icon className="size-5 text-brand-text" />
                <h3 className="mt-3 text-md font-semibold">{guide.title}</h3>
                <p className="mt-1 text-sm text-text-2">{guide.text}</p>
                <p className="mt-3 font-mono text-xs text-muted">{guide.file}</p>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
