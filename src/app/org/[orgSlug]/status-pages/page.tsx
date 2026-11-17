import type { Metadata } from "next";

import { StatusPagesPage } from "@/features/status-pages/status-pages-page";

export const metadata: Metadata = { title: "Status pages" };
export default function Page() {
  return <StatusPagesPage />;
}
