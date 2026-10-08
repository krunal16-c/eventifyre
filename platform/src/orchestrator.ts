import { config } from "./config.js";
import { store } from "./store.js";
import { createBlueprint } from "./agents/director.js";
import { buildPlan } from "./agents/planner.js";
import { runAgentTask, type AgentResult } from "./agents/specialist.js";
import * as comms from "./comms/index.js";
import type { Brief, Communication, EventRecord, Task } from "./types.js";
import { addDays, nowIso, pool, uid } from "./util.js";

/**
 * The orchestrator is the production office: it turns a brief into a staffed
 * plan, then keeps dispatching agents to every task whose dependencies are
 * done and whose time has come, pauses on host approvals, and wakes agents
 * when vendors reply.
 */

const pumping = new Set<string>();
const repump = new Set<string>();

export async function createEvent(brief: Brief, opts: { fastForward?: boolean } = {}): Promise<EventRecord> {
  const rec = store.create(brief);
  if (opts.fastForward) await store.mutate(rec.id, (r) => { r.fastForward = true; });
  void planEvent(rec.id).catch((err) => fail(rec.id, err));
  return rec;
}

async function fail(eventId: string, err: unknown) {
  console.error(`[orchestrator] ${eventId}:`, err);
  await store.mutate(eventId, (r) => { r.status = "failed"; r.error = (err as Error).message; });
}

export async function planEvent(eventId: string): Promise<void> {
  const rec = store.get(eventId)!;
  await store.mutate(eventId, (r) => { r.status = "planning"; });
  await store.log(eventId, "event_director", "status", "Reading your vision and drafting the event blueprint…");

  const blueprint = await createBlueprint(rec.brief);
  const plan = buildPlan(blueprint, rec.brief);

  await store.mutate(eventId, (r) => {
    r.blueprint = blueprint;
    r.roster = plan.roster;
    r.tasks = plan.tasks;
    r.budget = plan.budget;
    r.timeline = plan.timeline;
    r.status = "running";
    // The blueprint itself is the director's first deliverable.
    const bpTask = r.tasks.find((t) => t.key === "event_director.blueprint");
    if (bpTask) Object.assign(bpTask, { status: "done", output: blueprint.summary, updatedAt: nowIso() });
  });
  await store.log(eventId, "event_director", "status",
    `Blueprint ready: "${blueprint.title}" (${blueprint.eventType}). Staffed ${plan.roster.length} AI agents across ${new Set(plan.roster.map((a) => a.department)).size} departments with ${plan.tasks.length} tasks.`);
  await pump(eventId);
}

/** Earliest date a task may start, so day-of and wrap-up work waits for the calendar. */
function notBefore(rec: EventRecord, task: Task): string | null {
  const date = rec.blueprint?.date;
  if (!date || rec.fastForward) return null;
  if (task.phase === "execution") return date;
  if (task.phase === "wrapup") return addDays(date, 1);
  if (task.phase === "preparation" && task.dueDate) return addDays(task.dueDate, -10);
  return null;
}

function refreshReadiness(rec: EventRecord): Task[] {
  const done = new Set(rec.tasks.filter((t) => t.status === "done" || t.status === "skipped").map((t) => t.key));
  const today = nowIso().slice(0, 10);
  const runnable: Task[] = [];
  for (const task of rec.tasks) {
    if (task.status === "pending" && task.dependsOn.every((d) => done.has(d))) task.status = "ready";
    if (task.status !== "ready") continue;
    const start = notBefore(rec, task);
    if (start && start > today) continue;
    runnable.push(task);
  }
  return runnable;
}

/** Run every runnable task, repeatedly, until the event is waiting on the host, vendors or the calendar. */
export async function pump(eventId: string): Promise<void> {
  if (pumping.has(eventId)) { repump.add(eventId); return; }
  pumping.add(eventId);
  try {
    for (let round = 0; round < 50; round++) {
      const rec = store.get(eventId);
      if (!rec || rec.status === "paused" || rec.status === "failed" || !rec.blueprint) break;
      const runnable = await store.mutate(eventId, (r) => {
        const ready = refreshReadiness(r);
        for (const t of ready) { t.status = "in_progress"; t.attempts++; t.updatedAt = nowIso(); }
        for (const a of r.roster) a.status = ready.some((t) => t.roleId === a.roleId) ? "working" : a.status === "working" ? "idle" : a.status;
        return ready.map((t) => ({ ...t }));
      });
      if (runnable.length === 0) {
        if (repump.delete(eventId)) continue;
        break;
      }
      await pool(runnable, config.agentConcurrency, (task) => runOne(eventId, task));
    }
    await settleStatus(eventId);
  } finally {
    pumping.delete(eventId);
  }
  if (repump.delete(eventId)) await pump(eventId);
}

async function runOne(eventId: string, task: Task): Promise<void> {
  await store.log(eventId, task.roleId, "action", `Started: ${task.title}`);
  let result: AgentResult;
  try {
    result = await runAgentTask(eventId, task);
  } catch (err) {
    result = { status: "blocked" as const, summary: `Error: ${(err as Error).message}` };
  }
  await store.mutate(eventId, (r) => {
    const t = r.tasks.find((x) => x.id === task.id)!;
    // Approval-gated tasks can't be closed by the agent alone, whatever it claims.
    const taskApprovals = r.approvals.filter((a) => a.taskId === t.id);
    if (result.status === "done" && t.requiresApproval && !taskApprovals.some((a) => a.status === "approved")) {
      result = taskApprovals.some((a) => a.status === "pending")
        ? { status: "waiting_approval" as const, summary: result.summary }
        : { status: "blocked" as const, summary: `Needs host approval before it can be completed (agent said: ${result.summary})` };
    }
    t.status = result.status;
    t.output = result.summary;
    t.updatedAt = nowIso();
    // A blocked task gets one automatic retry; after that a human looks at it.
    if (result.status === "blocked" && t.attempts < 2) t.status = "ready";
    // Waiting for approval but nothing pending (e.g. auto-approved): continue.
    if (t.status === "waiting_approval" && !r.approvals.some((a) => a.taskId === t.id && a.status === "pending")) t.status = "ready";
    applyGuardrails(r, t);
    const roleTasks = r.tasks.filter((x) => x.roleId === t.roleId);
    const a = r.roster.find((x) => x.roleId === t.roleId);
    if (a) a.status = roleTasks.every((x) => x.status === "done" || x.status === "skipped") ? "done" : roleTasks.some((x) => x.status.startsWith("waiting")) ? "waiting" : "idle";
  });
  await store.log(eventId, task.roleId, "status", `${result.status === "done" ? "Done" : result.status.replace("_", " ")}: ${task.title} — ${result.summary}`);
}

/**
 * Under the "budget_guardrails" autonomy level, bookings within the category's
 * remaining estimate and under 10% of the total budget are approved
 * automatically; everything else still goes to the host.
 */
function applyGuardrails(r: EventRecord, task: Task) {
  if (r.brief.autonomy !== "budget_guardrails" || !r.blueprint) return;
  const ceiling = r.blueprint.budget * 0.1;
  for (const a of r.approvals) {
    if (a.taskId !== task.id || a.status !== "pending" || a.kind !== "booking" || a.amount === undefined) continue;
    if (a.amount <= ceiling) {
      a.status = "approved";
      a.decisionNote = `Auto-approved: within guardrail (≤ ${Math.round(ceiling)})`;
      a.decidedAt = nowIso();
      task.status = "ready";
    }
  }
}

async function settleStatus(eventId: string) {
  await store.mutate(eventId, (r) => {
    if (r.status === "paused" || r.status === "failed") return;
    const open = r.tasks.filter((t) => t.status !== "done" && t.status !== "skipped");
    if (open.length === 0) r.status = "completed";
    else if (r.approvals.some((a) => a.status === "pending") || open.some((t) => t.status === "blocked")) r.status = "awaiting_host";
    else if (open.every((t) => t.status === "ready" || t.status === "pending")) r.status = "scheduled";
    else r.status = "running";
  });
}

export async function decideApproval(eventId: string, approvalId: string, approve: boolean, note?: string): Promise<void> {
  const rec = store.get(eventId);
  const approval = rec?.approvals.find((a) => a.id === approvalId);
  if (!rec || !approval) throw new Error("Approval not found");
  if (approval.status !== "pending") throw new Error("Approval already decided");

  await store.mutate(eventId, (r) => {
    const a = r.approvals.find((x) => x.id === approvalId)!;
    a.status = approve ? "approved" : "rejected";
    a.decisionNote = note;
    a.decidedAt = nowIso();
    if (approve && a.quoteId) {
      const q = r.quotes.find((x) => x.id === a.quoteId);
      if (q) q.status = "accepted";
    }
    if (a.action?.type === "publish_asset") {
      const asset = r.marketing.find((m) => m.id === a.action!.payload.assetId);
      if (asset) asset.status = approve ? "approved" : "draft";
    }
  });
  await store.log(eventId, approval.roleId, "approval", `Host ${approve ? "approved" : "rejected"}: ${approval.title}${note ? ` — "${note}"` : ""}`);

  if (approve && approval.action?.type === "send") {
    const p = approval.action.payload as { channel: "email" | "sms" | "voice"; vendorId?: string; to: string; subject?: string; body: string };
    const r = store.get(eventId)!;
    const comm = await comms.send({ event: r, roleId: approval.roleId, channel: p.channel, vendor: r.vendors.find((v) => v.id === p.vendorId), to: p.to, subject: p.subject, body: p.body });
    await store.mutate(eventId, (rr) => { rr.communications.push(comm); });
  }

  await store.mutate(eventId, (r) => {
    const task = r.tasks.find((t) => t.id === approval.taskId);
    if (task && task.status === "waiting_approval" && !r.approvals.some((a) => a.taskId === task.id && a.status === "pending")) {
      task.status = "ready";
    }
  });
  void pump(eventId);
}

/** Route an inbound vendor message (SMS, email, call speech) to the agent that owns the conversation. */
export async function handleInbound(input: { channel: Communication["channel"]; from: string; to?: string; subject?: string; body: string; eventId?: string; vendorId?: string; provider: string; providerId?: string }): Promise<Communication | null> {
  let rec = input.eventId ? store.get(input.eventId) : undefined;
  let vendorId = input.vendorId;
  let lastOutbound: Communication | undefined;

  const matches = (c: Communication) => c.direction === "outbound" && (vendorId ? c.vendorId === vendorId : c.to?.toLowerCase() === input.from.toLowerCase());
  for (const candidate of rec ? [rec] : store.list()) {
    const found = [...candidate.communications].reverse().find(matches);
    if (found) { rec = candidate; lastOutbound = found; vendorId ??= found.vendorId; break; }
  }
  if (!rec) return null;

  const comm: Communication = {
    id: uid("msg"), eventId: rec.id, roleId: lastOutbound?.roleId ?? "event_director", vendorId,
    channel: input.channel, direction: "inbound", from: input.from, to: input.to, subject: input.subject, body: input.body,
    status: "received", provider: input.provider, providerId: input.providerId,
    threadKey: lastOutbound?.threadKey ?? comms.threadKey(rec.id, vendorId ?? input.from), createdAt: nowIso(),
  };
  const optOut = comms.isOptOut(input.body);
  await store.mutate(rec.id, (r) => {
    r.communications.push(comm);
    if (optOut && vendorId) {
      const v = r.vendors.find((x) => x.id === vendorId);
      if (v) v.doNotContact = true;
    }
    if (!optOut) {
      for (const t of r.tasks) if (t.roleId === comm.roleId && t.status === "waiting_vendor") t.status = "ready";
    }
  });
  await store.log(rec.id, comm.roleId, "message", `${optOut ? "Opt-out received from" : "Reply from"} ${rec.vendors.find((v) => v.id === vendorId)?.name ?? input.from} via ${input.channel}`);
  if (!optOut) void pump(rec.id);
  return comm;
}

export async function setPaused(eventId: string, paused: boolean) {
  await store.mutate(eventId, (r) => { r.status = paused ? "paused" : "running"; });
  if (!paused) void pump(eventId);
}

export async function retryTask(eventId: string, taskId: string) {
  await store.mutate(eventId, (r) => {
    const t = r.tasks.find((x) => x.id === taskId);
    if (t && (t.status === "blocked" || t.status === "waiting_vendor")) { t.status = "ready"; t.attempts = 0; }
  });
  void pump(eventId);
}

/** Periodic tick: picks up date-gated tasks (T-3 confirmations, event day, wrap-up). */
export function startScheduler(intervalMs = 10 * 60 * 1000) {
  return setInterval(() => {
    for (const rec of store.list()) {
      if (rec.status === "scheduled" || rec.status === "running" || rec.status === "awaiting_host") void pump(rec.id);
    }
  }, intervalMs).unref();
}
