"use client";

import { useParams } from "next/navigation";

import { Card } from "@/components/ui/card";
import { PageContainer } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { MonitorForm } from "@/features/monitors/monitor-form";
import { useOrgQuery } from "@/features/shared";
import type { MonitorDto } from "@/shared/types";

export default function Page() {
  const { monitorId } = useParams<{ monitorId: string }>();
  const monitor = useOrgQuery<MonitorDto>(["monitor", monitorId, "detail"], `/monitors/${monitorId}`);
  if (monitor.isError) return <PageContainer><Card><ErrorState title="Monitor not found" onRetry={() => monitor.refetch()} /></Card></PageContainer>;
  if (!monitor.data) return <PageContainer className="max-w-4xl"><Skeleton className="h-8 w-56" /><Skeleton className="mt-6 h-96" /></PageContainer>;
  // Keyed so the form re-initializes if a different monitor is opened.
  return <MonitorForm key={monitor.data.id} monitor={monitor.data} />;
}
