import { CheckCircle2, Siren, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";

const ROWS = [
  { name: "Checkout API", url: "GET api.example.com/checkout/health", status: "down", ms: "—", uptime: "99.82%" },
  { name: "Auth Service", url: "GET auth.example.com/health", status: "up", ms: "86 ms", uptime: "99.99%" },
  { name: "Storefront", url: "GET www.example.com", status: "up", ms: "141 ms", uptime: "100%" },
  { name: "Search API", url: "GET api.example.com/search/health", status: "slow", ms: "1.24 s", uptime: "99.95%" },
] as const;

// A fixed series: this is an illustration of the interface, not live data.
const LINE = [38, 36, 39, 35, 37, 34, 36, 33, 35, 34, 31, 33, 30, 32, 14, 11, 13, 29, 31, 30, 32, 31, 33, 32];

/**
 * A drawn illustration of the dashboard for the marketing page. It is labelled
 * as illustrative and uses example.com hosts; real figures live in the app.
 */
export function ProductPreview() {
  const width = 520, height = 120;
  const points = LINE.map((value, index) => `${(index / (LINE.length - 1)) * width},${(value / 44) * height}`).join(" ");
  return (
    <figure className="relative">
      <div className="pointer-events-none absolute -inset-x-10 -top-10 bottom-10 rounded-[3rem] bg-brand/10 blur-3xl" aria-hidden />
      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-lg" role="img" aria-label="Illustration of the PulseOps dashboard showing uptime, an open incident, and a list of monitors">
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-surface-3" /><span className="size-2.5 rounded-full bg-surface-3" /><span className="size-2.5 rounded-full bg-surface-3" />
          <span className="ml-3 rounded-md bg-surface-2 px-2.5 py-0.5 font-mono text-2xs text-muted">pulseops / acme / dashboard</span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-3" aria-hidden>
          {[["Uptime, 24h", "99.94%"], ["Avg response", "184 ms"], ["Active incidents", "1"]].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-bg/50 px-3.5 py-3"><p className="text-xs text-muted">{label}</p><p className="font-display text-xl font-semibold">{value}</p></div>
          ))}
        </div>
        <div className="mx-4 rounded-xl border border-border bg-bg/50 p-3.5" aria-hidden>
          <div className="flex items-center justify-between"><p className="text-xs text-muted">Response time</p><span className="flex items-center gap-1.5 text-2xs text-muted"><span className="h-0.5 w-3 rounded-full bg-(--chart-1)" />Average</span></div>
          <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-24 w-full" preserveAspectRatio="none">
            {[0.25, 0.5, 0.75].map((line) => <line key={line} x1="0" x2={width} y1={height * line} y2={height * line} stroke="var(--chart-grid)" />)}
            <polygon points={`0,${height} ${points} ${width},${height}`} fill="var(--chart-1)" opacity="0.1" />
            <polyline points={points} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <div className="m-4 flex items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5" aria-hidden>
          <Siren className="size-4 shrink-0 text-danger-fg" />
          <p className="min-w-0 flex-1 truncate text-sm"><span className="font-mono text-xs text-muted">INC-42</span> Checkout API is down <span className="text-muted">· opened automatically 2m ago</span></p>
          <Badge tone="danger">Investigating</Badge>
        </div>
        <ul className="border-t border-border" aria-hidden>
          {ROWS.map((row) => (
            <li key={row.name} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
              {row.status === "up" ? <CheckCircle2 className="size-4 shrink-0 text-ok-fg" /> : row.status === "down" ? <XCircle className="size-4 shrink-0 text-danger-fg" /> : <CheckCircle2 className="size-4 shrink-0 text-warn-fg" />}
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{row.name}</span><span className="block truncate font-mono text-2xs text-muted">{row.url}</span></span>
              <span className="hidden w-16 text-right text-sm tabular sm:block">{row.ms}</span>
              <span className="w-16 text-right text-sm text-text-2 tabular">{row.uptime}</span>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted">Illustrative interface with example data. Open the demo workspace for the real thing.</figcaption>
    </figure>
  );
}
