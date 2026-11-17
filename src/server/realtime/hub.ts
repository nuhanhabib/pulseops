import type Redis from "ioredis";

import { logger } from "../logger";
import { createSubscriber } from "../redis";
import { orgChannel } from "./publisher";

type Listener = (payload: string) => void;

/**
 * Fan-out from one Redis subscriber connection to every open SSE stream in
 * this process. Channels are reference-counted: the process subscribes to an
 * organization when its first viewer connects and unsubscribes when the last
 * one leaves, so idle tenants cost nothing.
 */
class RealtimeHub {
  private subscriber: Redis | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();

  private connection(): Redis {
    if (!this.subscriber) {
      this.subscriber = createSubscriber();
      this.subscriber.on("message", (channel: string, payload: string) => {
        for (const listener of this.listeners.get(channel) ?? []) {
          try {
            listener(payload);
          } catch {
            // One broken stream must not affect the others.
          }
        }
      });
      // ioredis re-subscribes automatically after a reconnect.
    }
    return this.subscriber;
  }

  subscribe(organizationId: string, listener: Listener): () => void {
    const channel = orgChannel(organizationId);
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      this.connection()
        .subscribe(channel)
        .catch((error: unknown) => logger.warn({ channel, err: String(error) }, "realtime subscribe failed"));
    }
    set.add(listener);

    return () => {
      const current = this.listeners.get(channel);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(channel);
        this.subscriber?.unsubscribe(channel).catch(() => {});
      }
    };
  }

  get streamCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}

const globalForHub = globalThis as unknown as { __pulseopsHub?: RealtimeHub };
export const realtimeHub = (globalForHub.__pulseopsHub ??= new RealtimeHub());
