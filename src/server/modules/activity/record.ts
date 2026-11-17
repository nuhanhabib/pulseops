import type { ActivityLevel, ActivityType } from "@/shared/enums";

import type { DbClient } from "../../db";

export interface ActivityInput {
  organizationId: string;
  type: ActivityType;
  level: ActivityLevel;
  title: string;
  description?: string | null;
  monitorId?: string | null;
  incidentId?: string | null;
  occurredAt?: Date;
}

/** Appends to the operational feed shown on the dashboard and in the activity inbox. */
export async function recordActivity(db: DbClient, input: ActivityInput): Promise<void> {
  await db.activityEvent.create({
    data: {
      organizationId: input.organizationId,
      type: input.type,
      level: input.level,
      title: input.title.slice(0, 200),
      description: input.description?.slice(0, 500) ?? null,
      monitorId: input.monitorId ?? null,
      incidentId: input.incidentId ?? null,
      occurredAt: input.occurredAt ?? new Date(),
    },
  });
}
