"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, use, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { orgKey, useOrg } from "@/features/org/org-context";
import type { RealtimeEnvelope } from "@/shared/realtime";

export type ConnectionState = "connecting" | "live" | "reconnecting";

const RealtimeContext = createContext<ConnectionState>("connecting");
export const useConnectionState = () => use(RealtimeContext);

/** Which cached queries each event makes stale. */
function affected(event: RealtimeEnvelope): unknown[][] {
  switch (event.type) {
    case "monitor.checked":
      return [["monitors"], ["monitor", event.monitorId], ["dashboard"]];
    case "monitor.status_changed":
      return [["monitors"], ["monitor", event.monitorId], ["dashboard"], ["analytics"], ["status-pages"]];
    case "monitor.changed":
      return [["monitors"], ["monitor", event.monitorId], ["dashboard"], ["status-pages"]];
    case "incident.created":
    case "incident.resolved":
    case "incident.updated":
      return [["incidents"], ["incident", event.incidentId], ["dashboard"], ["monitors"], ["analytics"]];
    case "activity.created":
      return [["activity"]];
    case "notification.updated":
      return [["notifications"]];
    case "statuspage.changed":
      return [["status-pages"]];
  }
}

/**
 * Keeps the UI live. One EventSource per organization; events mark cached
 * queries stale and TanStack Query refetches the ones on screen through the
 * normal API. Invalidations are batched so a burst of checks causes one
 * refetch, not twenty. After a reconnect everything is refreshed, because
 * events may have been missed while offline.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [state, setState] = useState<ConnectionState>("connecting");
  const slug = org.organization.slug;
  const pathsRef = useRef(org.paths);
  useEffect(() => {
    pathsRef.current = org.paths;
  }, [org.paths]);

  useEffect(() => {
    const pending = new Map<string, unknown[]>();
    const seen = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let everConnected = false;

    const flush = () => {
      flushTimer = undefined;
      for (const key of pending.values()) void queryClient.invalidateQueries({ queryKey: orgKey(slug, ...key) });
      pending.clear();
    };
    const queue = (keys: unknown[][]) => {
      for (const key of keys) pending.set(JSON.stringify(key), key);
      flushTimer ??= setTimeout(flush, 600);
    };

    const source = new EventSource(`${org.api}/stream`);
    source.onopen = () => {
      // The first open is the initial load; later opens follow a dropped connection.
      if (everConnected) void queryClient.invalidateQueries({ queryKey: orgKey(slug) });
      everConnected = true;
      setState("live");
    };
    source.onerror = () => setState(everConnected ? "reconnecting" : "connecting");
    source.onmessage = (message) => {
      let event: RealtimeEnvelope;
      try {
        event = JSON.parse(message.data) as RealtimeEnvelope;
      } catch {
        return;
      }
      if (seen.has(event.id)) return;
      seen.add(event.id);
      if (seen.size > 500) seen.clear();
      queue(affected(event));

      const paths = pathsRef.current;
      if (event.type === "incident.created") {
        toast.error(`INC-${event.number} opened`, {
          description: event.title,
          action: { label: "View", onClick: () => router.push(paths.incident(event.incidentId)) },
        });
      } else if (event.type === "incident.resolved") {
        toast.success(`INC-${event.number} resolved`, { description: event.title });
      } else if (event.type === "monitor.status_changed" && event.to === "DOWN") {
        toast.error(`${event.name} is down`, { action: { label: "View", onClick: () => router.push(paths.monitor(event.monitorId)) } });
      } else if (event.type === "monitor.status_changed" && event.from === "DOWN") {
        toast.success(`${event.name} recovered`);
      }
    };

    return () => {
      source.close();
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [org.api, slug, queryClient, router]);

  return <RealtimeContext value={state}>{children}</RealtimeContext>;
}
