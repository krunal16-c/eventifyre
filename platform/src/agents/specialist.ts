import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, baseParams, textOf } from "../llm/client.js";
import { config, llmEnabled } from "../config.js";
import { getRole } from "../catalog/roles.js";
import { store } from "../store.js";
import type { EventRecord, Task } from "../types.js";
import { runTool, toolSpecs, type ToolContext } from "./tools.js";
import { simulateTask } from "./simulator.js";

export interface AgentResult {
  status: "done" | "waiting_vendor" | "waiting_approval" | "blocked";
  summary: string;
}

const COMPANY_RULES = `You work for Eventifyre, an AI-native event production company. A host told us their vision; a team of
AI agents — each replacing one human role on a professional event team — plans and runs the whole event.

How you work:
- Start by calling get_event_context to see the blueprint and the current state. Build on what other agents already did.
- Act, don't just plan: find real vendors, contact them, gather quotes, draft content, update the budget and timeline.
- Contact several options in parallel (typically 3) so the host gets a real choice. Prefer email for detailed requests,
  SMS for quick checks and confirmations, calls when speed matters or a vendor doesn't answer.
- Messages to vendors must be specific (date, headcount, location, requirements, budget range if helpful) and honest:
  you are an AI assistant acting for the host. Never invent facts about the host or the event.
- Never book, pay, sign or publish on your own. Use request_approval with your recommendation, the alternatives and the
  key terms (price, deposit, cancellation policy). Approved items can then be confirmed with the vendor.
- Stay inside the budget line for your category. If the numbers don't work, say so and propose options.
- If you discover work that isn't covered by any task (a permit, a missing rental, a dietary issue), create it with add_task
  and assign it to the right role, so nothing is missed.
- Record risks with log_risk when you spot them.
- Finish every task with complete_task and a short summary written for the host.`;

function systemPrompt(roleId: string): string {
  const role = getRole(roleId);
  if (!role) return COMPANY_RULES;
  return `${COMPANY_RULES}

Your role: ${role.title} (${role.department}).
Mission: ${role.mission}
Responsibilities:
${role.responsibilities.map((r) => `- ${r}`).join("\n")}
Typical vendor categories: ${role.vendorCategories.join(", ") || "n/a"}
Channels you use: ${role.channels.join(", ")}`;
}

function taskPrompt(rec: EventRecord, task: Task): string {
  const decided = rec.approvals.filter((a) => a.taskId === task.id && a.status !== "pending");
  const inbound = rec.communications.filter((c) => c.roleId === task.roleId && c.direction === "inbound" && c.createdAt > task.updatedAt);
  const lines = [
    `Today: ${new Date().toISOString().slice(0, 10)}. Event: "${rec.blueprint?.title}" on ${rec.blueprint?.date ?? "date TBD"} in ${rec.blueprint?.city}.`,
    `Your task (${task.key}): ${task.title}`,
    task.description,
    task.dueDate ? `Due: ${task.dueDate}` : "",
    task.requiresApproval ? "This task cannot be completed until the host approves it: use request_approval (or create_marketing_asset for content), then complete_task(status='waiting_approval'). Once approved, finish the follow-through and complete it as done." : "",
    task.vendorCategory ? `Vendor category: ${task.vendorCategory}` : "",
    task.output ? `\nWhere you left off:\n${task.output}` : "",
  ];
  if (decided.length) {
    lines.push("\nHost decisions since your last run:");
    for (const a of decided) lines.push(`- ${a.title}: ${a.status.toUpperCase()}${a.decisionNote ? ` — "${a.decisionNote}"` : ""}`);
    lines.push("Act on these: confirm approved bookings with the vendor and update the budget's committed amount; for rejections, follow the host's note or present alternatives.");
  }
  if (inbound.length) {
    lines.push("\nNew replies from vendors:");
    for (const c of inbound) lines.push(`- [${c.channel}] ${rec.vendors.find((v) => v.id === c.vendorId)?.name ?? c.from}: ${c.body.slice(0, 800)}`);
  }
  return lines.filter(Boolean).join("\n");
}

export async function runAgentTask(eventId: string, task: Task): Promise<AgentResult> {
  if (!llmEnabled()) return simulateTask(eventId, task);

  const rec = store.get(eventId)!;
  const ctx: ToolContext = { eventId, roleId: task.roleId, taskId: task.id };
  const tools = toolSpecs();
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: taskPrompt(rec, task) }];

  for (let turn = 0; turn < config.maxAgentTurns; turn++) {
    const response = await anthropic().beta.messages.create({
      ...baseParams(),
      max_tokens: 16000,
      system: systemPrompt(task.roleId),
      tools,
      messages,
      cache_control: { type: "ephemeral" },
    });

    if (response.stop_reason === "refusal") {
      return { status: "blocked", summary: "The model declined to continue this task; needs a human to review." };
    }
    messages.push({ role: "assistant", content: response.content });

    const thought = textOf(response.content);
    if (thought) await store.log(eventId, task.roleId, "thought", thought.slice(0, 1000));

    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason === "max_tokens") {
      messages.push({ role: "user", content: "You ran out of room. Continue concisely and finish with complete_task." });
      continue;
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      return { status: "done", summary: thought || "Completed." };
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let finish: AgentResult | null = null;
    for (const use of toolUses) {
      const outcome = await runTool(use.name, use.input, ctx);
      await store.log(eventId, task.roleId, outcome.isError ? "error" : "tool", `${use.name} ${outcome.isError ? "failed: " + JSON.stringify(outcome.result).slice(0, 300) : summarizeInput(use.input)}`);
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(outcome.result), is_error: outcome.isError });
      if (outcome.stop) finish = { status: outcome.stop, summary: outcome.summary ?? "" };
    }
    messages.push({ role: "user", content: results });
    if (finish) return finish;
  }
  return { status: "blocked", summary: "Agent hit its turn limit before finishing; will retry with a fresh run." };
}

function summarizeInput(input: unknown): string {
  const s = JSON.stringify(input);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}
