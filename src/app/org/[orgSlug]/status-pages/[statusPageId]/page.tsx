"use client";

import { useParams } from "next/navigation";

import { StatusPageEditorPage } from "@/features/status-pages/status-page-editor";

export default function Page() {
  const { statusPageId } = useParams<{ statusPageId: string }>();
  return <StatusPageEditorPage statusPageId={statusPageId} />;
}
