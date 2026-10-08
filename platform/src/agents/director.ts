import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { anthropic, baseParams } from "../llm/client.js";
import { llmEnabled } from "../config.js";
import { classifyEventType, EVENT_TYPES, getEventType } from "../catalog/eventTypes.js";
import type { Blueprint, Brief } from "../types.js";

/**
 * Event Director: reads the host's questionnaire + free-text vision and
 * produces the Blueprint every other agent works from.
 */

const BlueprintSchema = z.object({
  title: z.string().describe("Short, evocative event title"),
  eventType: z.string().describe(`One of: ${EVENT_TYPES.map((t) => t.id).join(", ")}, custom`),
  summary: z.string().describe("2-3 sentence summary of the event as the host imagines it"),
  theme: z.string(),
  goals: z.array(z.string()).describe("What success looks like for the host"),
  date: z.string().nullable().describe("ISO date YYYY-MM-DD, or null if not yet decided"),
  durationHours: z.number(),
  city: z.string(),
  guestCount: z.number(),
  budget: z.number().describe("Total budget in the given currency"),
  currency: z.string(),
  venueRequirements: z.array(z.string()),
  experienceMoments: z.array(z.string()).describe("Signature moments of the guest journey, in order"),
  styleKeywords: z.array(z.string()),
  audience: z.string(),
  ticketed: z.boolean(),
  constraints: z.array(z.string()).describe("Hard constraints: dietary, accessibility, cultural, legal, deal-breakers"),
  openQuestions: z.array(z.string()).describe("Decisions or information the host still needs to provide"),
  budgetAllocation: z.array(z.object({ category: z.string(), percent: z.number() })).describe("Percentages summing to 100"),
});

const SYSTEM = `You are the Event Director at Eventifyre, an AI-native event production company.
A host has described the event they want. Turn it into a precise, realistic blueprint that a team of
specialist agents (venue, catering, decor, entertainment, marketing, logistics, legal, finance, etc.)
will execute without further hand-holding.

Rules:
- Honor everything the host said; never contradict an explicit answer from the questionnaire.
- Fill gaps with sensible, clearly reasonable defaults for this kind of event and city, and list anything
  that genuinely needs the host's decision under openQuestions (keep it short: only real blockers).
- Budget allocation must be realistic for the event type and city and must sum to 100, including a contingency line.
- If the budget looks unrealistic for the vision, keep the host's number but say so in openQuestions with a concrete suggestion.`;

export async function createBlueprint(brief: Brief): Promise<Blueprint> {
  if (!llmEnabled()) return heuristicBlueprint(brief);

  const response = await anthropic().beta.messages.parse({
    ...baseParams("high"),
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Today is ${new Date().toISOString().slice(0, 10)}.\nHost questionnaire (JSON):\n${JSON.stringify(brief, null, 2)}\n\nKeyword classifier hint: ${classifyEventType(`${brief.eventType ?? ""} ${brief.vision}`).id}`,
    }],
    output_config: { ...baseParams("high").output_config, format: betaZodOutputFormat(BlueprintSchema) },
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    return heuristicBlueprint(brief);
  }
  return normalize(response.parsed_output, brief);
}

function normalize(bp: Blueprint, brief: Brief): Blueprint {
  const total = bp.budgetAllocation.reduce((s, a) => s + a.percent, 0);
  if (total > 0 && Math.abs(total - 100) > 1) {
    bp.budgetAllocation = bp.budgetAllocation.map((a) => ({ ...a, percent: Math.round((a.percent / total) * 1000) / 10 }));
  }
  // Questionnaire answers always win over model inference.
  if (brief.date) bp.date = brief.date;
  if (brief.guestCount) bp.guestCount = brief.guestCount;
  if (brief.budget) bp.budget = brief.budget;
  if (brief.city) bp.city = brief.city;
  return bp;
}

/** Deterministic blueprint used offline (no API key) and as a refusal fallback. */
export function heuristicBlueprint(brief: Brief): Blueprint {
  const profile = brief.eventType && brief.eventType !== "auto" ? getEventType(brief.eventType) : classifyEventType(brief.vision);
  const guestCount = brief.guestCount ?? profile.defaultGuests;
  const budget = brief.budget ?? guestCount * 120;
  const vision = brief.vision.trim();
  const words = vision.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? [];
  const stop = new Set(["with", "that", "want", "would", "like", "have", "this", "they", "their", "about", "from", "where", "which", "should", "event", "party", "guests", "people", "some", "really", "make", "also", "just", "into", "there", "will"]);
  const styleKeywords = [...new Set(words.filter((w) => !stop.has(w)))].slice(0, 8);
  const openQuestions: string[] = [];
  if (!brief.date) openQuestions.push("What date (or date range) should we target?");
  if (!brief.budget) openQuestions.push(`No budget given — we assumed ${budget} ${brief.currency ?? "USD"}. Please confirm.`);
  if (!brief.guestCount) openQuestions.push(`Roughly how many guests? We assumed ${guestCount}.`);

  return {
    title: vision.split(/[.!\n]/)[0].slice(0, 70) || profile.label,
    eventType: profile.id,
    summary: vision.slice(0, 400),
    theme: styleKeywords.slice(0, 3).join(" · ") || profile.label,
    goals: ["Deliver the host's vision on time and on budget", "Guests leave delighted and talking about it", "Zero surprises for the host on the day"],
    date: brief.date ?? null,
    durationHours: profile.defaultDurationHours,
    city: brief.city,
    guestCount,
    budget,
    currency: brief.currency ?? "USD",
    venueRequirements: [`Capacity for ${guestCount}`, brief.venuePreference ?? "Style matching the vision", "Step-free access"],
    experienceMoments: ["Arrival & welcome", "Main experience", "Dining", "Highlight moment", "Farewell"],
    styleKeywords,
    audience: brief.audience ?? "Invited guests",
    ticketed: brief.ticketed ?? profile.typicallyTicketed,
    constraints: [brief.dietaryNeeds, brief.accessibilityNeeds, brief.dealBreakers].filter((x): x is string => Boolean(x)),
    openQuestions,
    budgetAllocation: profile.budgetAllocation,
  };
}
