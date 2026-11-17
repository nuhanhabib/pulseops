import { orgRoute } from "@/server/http/handler";
import { realtimeHub } from "@/server/realtime/hub";

/** How long one stream lives. The browser reconnects, which re-checks the session and membership. */
const MAX_STREAM_MS = 10 * 60_000;
const HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events for one organization.
 *
 * Authorization happens in `orgRoute` before the stream opens, and the
 * channel name is derived from the verified membership, never from anything
 * the client sends. Streams are short-lived on purpose: a member who is
 * removed loses real-time access within `MAX_STREAM_MS` at the latest.
 */
export const GET = orgRoute({ permission: "monitor:read" }, async ({ ctx, request }) => {
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = realtimeHub.subscribe(ctx.organization.id, (payload) => send(`data: ${payload}\n\n`));
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      const lifetime = setTimeout(() => cleanup(), MAX_STREAM_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      request.signal.addEventListener("abort", cleanup);
      // `retry` sets the browser's reconnect delay; the comment flushes headers through proxies.
      send("retry: 3000\n: connected\n\n");
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
