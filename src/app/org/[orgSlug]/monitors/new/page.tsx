import type { Metadata } from "next";

import { MonitorForm } from "@/features/monitors/monitor-form";

export const metadata: Metadata = { title: "New monitor" };
export default function Page() {
  return <MonitorForm />;
}
