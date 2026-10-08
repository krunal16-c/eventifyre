import { anthropic, baseParams, textOf } from "../llm/client.js";
import { llmEnabled } from "../config.js";
import { store } from "../store.js";

const MAX_TURNS = 4;

/**
 * Next thing the AI caller says, given the call so far. Kept short because it
 * is spoken; ends the call after a few exchanges and hands the rest to email.
 */
export async function nextVoiceLine(eventId: string, threadKey: string, turn: number): Promise<{ say: string; hangup: boolean }> {
  if (turn >= MAX_TURNS) return { say: "Thank you so much, that's really helpful. We'll follow up in writing shortly. Have a great day!", hangup: true };
  const rec = store.get(eventId);
  const transcript = (rec?.communications ?? []).filter((c) => c.threadKey === threadKey && c.channel === "voice")
    .map((c) => `${c.direction === "outbound" ? "AI" : "Vendor"}: ${c.body}`).join("\n");

  if (!llmEnabled() || !rec?.blueprint) {
    return { say: "Thank you, I've noted that. Could you share your pricing and the best email to send details to?", hangup: false };
  }
  const response = await anthropic().beta.messages.create({
    ...baseParams("low"),
    max_tokens: 2000,
    system: `You are an AI assistant on a phone call with an event vendor on behalf of a host. Event: ${rec.blueprint.title}, ${rec.blueprint.date ?? "date TBD"}, ${rec.blueprint.guestCount} guests, ${rec.blueprint.city}.
Reply with ONE short spoken sentence or two (no lists, no markdown). Goal: availability, price, key terms, and the best email for follow-up.
Never agree to book, pay or sign. If you have what you need, thank them and end with the exact token [END].`,
    messages: [{ role: "user", content: `Call so far:\n${transcript}\n\nWhat do you say next?` }],
  });
  const text = textOf(response.content) || "Thank you. We'll follow up by email.";
  const hangup = text.includes("[END]");
  return { say: text.replace("[END]", "").trim(), hangup };
}
