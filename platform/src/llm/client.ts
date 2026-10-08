import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

let client: Anthropic | null = null;

/** Lazily constructed so the app boots (in offline mode) without credentials. */
export function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/**
 * Shared request settings for every agent call: adaptive thinking (always on
 * for this model), an explicit effort level, and server-side refusal
 * fallbacks so a declined request is retried on a fallback model instead of
 * silently stalling an event.
 */
export function baseParams(effort = config.agentEffort) {
  return {
    model: config.model,
    thinking: { type: "adaptive" as const },
    output_config: { effort },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
  };
}

export function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
}
