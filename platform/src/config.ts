import path from "node:path";

const env = process.env;

/**
 * Outbound email/SMS/calls go to real people, so live sending is opt-in:
 * even with provider credentials present nothing leaves the building until
 * COMMS_LIVE=true. Otherwise every message is recorded as "simulated".
 */
export const config = {
  port: Number(env.PORT ?? 3000),
  publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT ?? 3000}`,
  dataDir: path.resolve(env.DATA_DIR ?? "data"),

  anthropicConfigured: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
  /** Force the offline simulator even if an Anthropic key is present (tests, demos). */
  offline: env.EVENTIFYRE_OFFLINE === "true",
  model: env.EVENTIFYRE_MODEL ?? "claude-opus-5-5",
  agentEffort: (env.EVENTIFYRE_AGENT_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max",
  maxAgentTurns: Number(env.EVENTIFYRE_MAX_AGENT_TURNS ?? 12),
  agentConcurrency: Number(env.EVENTIFYRE_AGENT_CONCURRENCY ?? 4),

  commsLive: env.COMMS_LIVE === "true",
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    fromNumber: env.TWILIO_FROM_NUMBER,
  },
  email: {
    resendApiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM ?? "Eventifyre Agents <agents@eventifyre.ai>",
    replyDomain: env.EMAIL_REPLY_DOMAIN, // e.g. reply.eventifyre.ai → evt-<id>+<thread>@reply.eventifyre.ai
  },
  googlePlacesApiKey: env.GOOGLE_PLACES_API_KEY,
  /** Shared secret for inbound email webhooks (Twilio requests are signature-checked). */
  webhookSecret: env.WEBHOOK_SECRET,
};

export function llmEnabled(): boolean {
  return config.anthropicConfigured && !config.offline;
}
