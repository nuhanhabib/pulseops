import { z } from "zod";

/** The shape every provider must return. Also the structured-output schema sent to the model. */
export const incidentAnalysisSchema = z.object({
  summary: z.string().describe("Two or three sentences describing what is happening, in plain language."),
  possibleCauses: z
    .array(
      z.object({
        cause: z.string(),
        likelihood: z.enum(["low", "medium", "high"]),
        reasoning: z.string().describe("Which evidence supports or weakens this hypothesis."),
      }),
    )
    .describe("Hypotheses, most likely first. Hypotheses, not conclusions."),
  supportingEvidence: z.array(z.string()).describe("Specific observations from the supplied data."),
  troubleshootingSteps: z.array(z.string()).describe("Concrete, ordered checks a responder can run."),
  recommendedActions: z.array(z.string()).describe("Next actions for the team. Never destructive or automatic."),
  draftUpdate: z.string().describe("A short status update suitable for customers. No internal detail."),
  caveats: z.array(z.string()).describe("What the data cannot show."),
});

export type IncidentAnalysisOutput = z.infer<typeof incidentAnalysisSchema>;
