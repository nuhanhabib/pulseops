import type { AiStatusDto, IncidentAnalysisContent, IncidentAnalysisDto } from "@/shared/types";

import { recordAudit } from "../../audit";
import { type Prisma, prisma } from "../../db";
import { getEnv, isAiEnabled } from "../../env";
import { notFound } from "../../errors";
import { enforceRateLimit } from "../../rate-limit";
import { authorize, type OrgContext } from "../../tenancy";
import { iso, toUserRef, userRefSelect } from "../mappers";
import { buildIncidentContext } from "./context";
import { getAiProvider } from "./provider";

const include = { requestedBy: { select: userRefSelect } } satisfies Prisma.IncidentAnalysisInclude;

function toDto(row: Prisma.IncidentAnalysisGetPayload<{ include: typeof include }>): IncidentAnalysisDto {
  return {
    id: row.id, provider: row.provider, model: row.model, content: row.content as unknown as IncidentAnalysisContent,
    usage: { inputTokens: row.inputTokens, outputTokens: row.outputTokens }, requestedBy: toUserRef(row.requestedBy),
    isSample: row.isSample, createdAt: iso(row.createdAt),
  };
}

export function getAiStatus(): AiStatusDto {
  const env = getEnv();
  const enabled = isAiEnabled();
  return { enabled, provider: enabled ? env.AI_PROVIDER : null, model: enabled ? env.AI_MODEL : null, hourlyLimit: env.AI_RATE_LIMIT_PER_HOUR };
}

async function assertIncident(ctx: OrgContext, incidentId: string) {
  const incident = await prisma.incident.findFirst({ where: { id: incidentId, organizationId: ctx.organization.id }, select: { id: true, number: true } });
  if (!incident) throw notFound("Incident");
  return incident;
}

export async function listAnalyses(ctx: OrgContext, incidentId: string): Promise<IncidentAnalysisDto[]> {
  authorize(ctx, "incident:read");
  const incident = await assertIncident(ctx, incidentId);
  const rows = await prisma.incidentAnalysis.findMany({
    where: { incidentId: incident.id, organizationId: ctx.organization.id }, include, orderBy: { createdAt: "desc" }, take: 5,
  });
  return rows.map(toDto);
}

/**
 * Generates and stores an analysis. Advisory only: this function reads
 * monitoring data and writes one IncidentAnalysis row. It cannot change a
 * monitor, an incident, or a status page.
 */
export async function analyzeIncident(ctx: OrgContext, incidentId: string): Promise<IncidentAnalysisDto> {
  authorize(ctx, "ai:use");
  const provider = getAiProvider();
  const incident = await assertIncident(ctx, incidentId);
  // Fails closed: if Redis is down we would rather refuse than run up an unbounded bill.
  await enforceRateLimit(
    { bucket: "ai:org", limit: getEnv().AI_RATE_LIMIT_PER_HOUR, windowSeconds: 3600, onStoreFailure: "deny" },
    ctx.organization.id,
    "This organization has used its AI analyses for the hour. Try again later.",
  );

  const context = await buildIncidentContext(ctx, incident.id);
  const result = await provider.analyzeIncident(context);

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.incidentAnalysis.create({
      data: {
        incidentId: incident.id, organizationId: ctx.organization.id, provider: provider.name, model: result.model,
        content: result.output as unknown as Prisma.InputJsonValue, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        requestedById: ctx.actor.userId,
      },
      include,
    });
    await recordAudit(tx, ctx, {
      action: "incident.analysis_requested", target: { type: "incident", id: incident.id, label: `INC-${incident.number}` },
      metadata: { provider: provider.name, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    });
    return created;
  });
  return toDto(row);
}
