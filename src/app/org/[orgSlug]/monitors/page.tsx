import type { Metadata } from "next";

import { MonitorsPage } from "@/features/monitors/monitors-page";

export const metadata: Metadata = { title: "Monitors" };
export default function Page() {
  return <MonitorsPage />;
}
