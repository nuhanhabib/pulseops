/**
 * The fictional services behind the demo workspace. Shared by the simulator
 * (which serves them) and the seed (which creates a monitor for each).
 */
export interface DemoService {
  slug: string;
  name: string;
  kind: "WEBSITE" | "API";
  category: string;
  method: "GET" | "HEAD";
  intervalSeconds: number;
  /** Typical response time in ms; the simulator adds jitter around it. */
  latencyMs: number;
  degradedThresholdMs: number;
  /** Share of requests that fail on a normal day. */
  errorRate: number;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  publicName?: string;
}

export const DEMO_SERVICES: DemoService[] = [
  { slug: "storefront", name: "Storefront", kind: "WEBSITE", category: "Customer-facing", method: "GET", intervalSeconds: 60, latencyMs: 140, degradedThresholdMs: 900, errorRate: 0.0005, severity: "CRITICAL", publicName: "Website" },
  { slug: "checkout-api", name: "Checkout API", kind: "API", category: "Customer-facing", method: "GET", intervalSeconds: 30, latencyMs: 190, degradedThresholdMs: 800, errorRate: 0.001, severity: "CRITICAL", publicName: "Checkout" },
  { slug: "auth-service", name: "Auth Service", kind: "API", category: "Platform", method: "GET", intervalSeconds: 30, latencyMs: 85, degradedThresholdMs: 500, errorRate: 0.0005, severity: "CRITICAL", publicName: "Sign-in" },
  { slug: "search-api", name: "Search API", kind: "API", category: "Customer-facing", method: "GET", intervalSeconds: 60, latencyMs: 310, degradedThresholdMs: 1200, errorRate: 0.002, severity: "HIGH", publicName: "Search" },
  { slug: "payments-gateway", name: "Payments Gateway", kind: "API", category: "Platform", method: "GET", intervalSeconds: 60, latencyMs: 230, degradedThresholdMs: 1000, errorRate: 0.001, severity: "CRITICAL", publicName: "Payments" },
  { slug: "notifications-api", name: "Notifications API", kind: "API", category: "Platform", method: "GET", intervalSeconds: 120, latencyMs: 160, degradedThresholdMs: 900, errorRate: 0.001, severity: "MEDIUM" },
  { slug: "docs", name: "Developer Docs", kind: "WEBSITE", category: "Customer-facing", method: "HEAD", intervalSeconds: 300, latencyMs: 70, degradedThresholdMs: 800, errorRate: 0.0003, severity: "LOW", publicName: "Documentation" },
  { slug: "cdn-edge", name: "CDN Edge", kind: "WEBSITE", category: "Infrastructure", method: "HEAD", intervalSeconds: 60, latencyMs: 35, degradedThresholdMs: 400, errorRate: 0.0002, severity: "HIGH" },
  { slug: "reports-export", name: "Reports Export", kind: "API", category: "Internal", method: "GET", intervalSeconds: 300, latencyMs: 1350, degradedThresholdMs: 1500, errorRate: 0.004, severity: "LOW" },
  { slug: "admin-console", name: "Admin Console", kind: "WEBSITE", category: "Internal", method: "GET", intervalSeconds: 300, latencyMs: 210, degradedThresholdMs: 1200, errorRate: 0.001, severity: "MEDIUM" },
];

export const demoTargetUrl = (baseUrl: string, slug: string) => `${baseUrl.replace(/\/+$/, "")}/services/${slug}/health`;
