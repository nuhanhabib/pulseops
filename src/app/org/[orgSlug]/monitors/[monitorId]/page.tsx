"use client";

import { useParams } from "next/navigation";

import { MonitorDetailPage } from "@/features/monitors/monitor-detail-page";

export default function Page() {
  const { monitorId } = useParams<{ monitorId: string }>();
  return <MonitorDetailPage monitorId={monitorId} />;
}
