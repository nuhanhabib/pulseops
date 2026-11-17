"use client";

import { useParams } from "next/navigation";

import { IncidentDetailPage } from "@/features/incidents/incident-detail-page";

export default function Page() {
  const { incidentId } = useParams<{ incidentId: string }>();
  return <IncidentDetailPage incidentId={incidentId} />;
}
