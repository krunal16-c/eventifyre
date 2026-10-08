import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { store } from "../store.js";
import { searchVendors } from "../vendors/directory.js";
import * as comms from "../comms/index.js";
import { simulateVendorReply } from "../comms/vendorSimulator.js";
import type { ApprovalKind, Communication, EventRecord, Phase, Vendor } from "../types.js";
import { PHASES } from "../types.js";
import { money, nowIso, uid } from "../util.js";

/**
 * The actions an agent can take in the world. Every tool:
 *  - validates its input with zod (model output is untrusted),
 *  - writes through the store (so the dashboard updates live),
 *  - respects the host's autonomy level and the approval gates.
 *
 * Money never moves and nothing is signed without an approved Approval.
 */

export interface ToolContext {
  eventId: string;
  roleId: string;
  taskId: string;
}

export interface ToolOutcome {
  /** JSON-serializable result returned to the model. */
  result: unknown;
  /** Set when the agent should stop working this task for now. */
  stop?: "waiting_approval" | "waiting_vendor" | "done" | "blocked";
  summary?: string;
}

interface ToolDef<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<ToolOutcome>;
}

const def = <S extends z.ZodType>(d: ToolDef<S>) => d;

const MAX_OUTBOUND_PER_TASK = 15;

function event(ctx: ToolContext): EventRecord {
  const rec = store.get(ctx.eventId);
  if (!rec) throw new Error("event not found");
  return rec;
}

function vendorBrief(v: Vendor) {
  return { id: v.id, name: v.name, category: v.category, rating: v.rating, priceLevel: v.priceLevel, hasEmail: Boolean(v.email), hasPhone: Boolean(v.phone), website: v.website, source: v.source, doNotContact: v.doNotContact ?? false };
}

function resolveRecipient(rec: EventRecord, channel: "email" | "sms" | "voice", vendorId?: string, to?: string) {
  const vendor = vendorId ? rec.vendors.find((v) => v.id === vendorId) : undefined;
  if (vendorId && !vendor) throw new Error(`Unknown vendor_id ${vendorId}. Use search_vendors or add_vendor first.`);
  if (vendor?.doNotContact) throw new Error(`${vendor.name} has opted out of contact. Choose another vendor.`);
  const address = to ?? (channel === "email" ? vendor?.email : vendor?.phone);
  if (!address) throw new Error(`No ${channel === "email" ? "email" : "phone number"} for ${vendor?.name ?? "recipient"}. Try another channel or ask the host.`);
  return { vendor, address };
}

/** Outbound message path shared by email/SMS/voice, including approval gating and simulated replies. */
async function outbound(ctx: ToolContext, channel: "email" | "sms" | "voice", input: { vendor_id?: string; to?: string; subject?: string; body: string }): Promise<ToolOutcome> {
  const rec = event(ctx);
  const sentForTask = rec.communications.filter((c) => c.direction === "outbound" && c.roleId === ctx.roleId && c.createdAt >= (rec.tasks.find((t) => t.id === ctx.taskId)?.updatedAt ?? "")).length;
  if (sentForTask >= MAX_OUTBOUND_PER_TASK) throw new Error("Outbound message limit for this task reached. Summarize and complete the task.");

  const { vendor, address } = resolveRecipient(rec, channel, input.vendor_id, input.to);

  if ((rec.brief.autonomy ?? "approve_commitments") === "approve_all") {
    const approval = await createApproval(ctx, {
      kind: "outbound_message",
      title: `Send ${channel} to ${vendor?.name ?? address}`,
      details: `${input.subject ? `Subject: ${input.subject}\n\n` : ""}${input.body}`,
      vendorId: vendor?.id,
      action: { type: "send", payload: { channel, vendorId: vendor?.id, to: address, subject: input.subject, body: input.body } },
    });
    return { result: { queued_for_host_approval: approval.id, note: "Host reviews every outbound message under their autonomy setting. You may queue other messages, then finish with complete_task(status='waiting_approval')." } };
  }

  const comm = await comms.send({ event: rec, roleId: ctx.roleId, channel, vendor, to: address, subject: input.subject, body: input.body });
  await store.mutate(ctx.eventId, (r) => { r.communications.push(comm); });

  const result: Record<string, unknown> = { message_id: comm.id, status: comm.status, channel, to: vendor?.name ?? address };
  if (comm.status === "simulated" && vendor) {
    const reply = simulateVendorReply(rec, vendor);
    const inbound: Communication = {
      id: uid("msg"), eventId: ctx.eventId, roleId: ctx.roleId, vendorId: vendor.id, channel, direction: "inbound",
      from: address, body: reply.body, status: "received", provider: "simulator", threadKey: comm.threadKey, createdAt: nowIso(),
    };
    await store.mutate(ctx.eventId, (r) => { r.communications.push(inbound); });
    result.vendor_reply = reply.body;
    result.note = "Comms are in simulation mode; the reply above is simulated. Record any quote with record_quote.";
  } else if (comm.status === "sent") {
    result.note = "Message sent. The vendor's reply will arrive asynchronously and wake you. Continue with other vendors, then complete_task(status='waiting_vendor') if you need their answer.";
  }
  return { result };
}

async function createApproval(ctx: ToolContext, a: { kind: ApprovalKind; title: string; details: string; amount?: number; vendorId?: string; quoteId?: string; options?: string[]; action?: { type: string; payload: Record<string, unknown> } }) {
  const approval = {
    id: uid("apr"), eventId: ctx.eventId, roleId: ctx.roleId, taskId: ctx.taskId, status: "pending" as const, createdAt: nowIso(), ...a,
  };
  await store.mutate(ctx.eventId, (r) => { r.approvals.push(approval); });
  await store.log(ctx.eventId, ctx.roleId, "approval", `Requested host approval: ${a.title}${a.amount ? ` (${money(a.amount, event(ctx).blueprint?.currency)})` : ""}`);
  return approval;
}

const phaseEnum = z.enum(PHASES as [Phase, ...Phase[]]);

export const TOOLS = [
  def({
    name: "get_event_context",
    description: "Read the current state of the event relevant to you: blueprint, your tasks, vendors, quotes, recent messages, budget, approvals, timeline. Call this first.",
    schema: z.object({ section: z.enum(["overview", "vendors", "quotes", "messages", "budget", "approvals", "timeline", "tasks", "all"]).describe("Which part of the event to read") }),
    async run({ section }, ctx) {
      const r = event(ctx);
      const mine = <T extends { roleId?: string }>(xs: T[]) => xs.filter((x) => x.roleId === ctx.roleId);
      const parts: Record<string, unknown> = {
        overview: { blueprint: r.blueprint, brief: { ...r.brief, hostEmail: undefined, hostPhone: undefined }, roster: r.roster.map((a) => `${a.roleId}: ${a.title}`) },
        vendors: r.vendors.map(vendorBrief),
        quotes: r.quotes.map((q) => ({ ...q, vendor: r.vendors.find((v) => v.id === q.vendorId)?.name })),
        messages: mine(r.communications).slice(-30).map((c) => ({ direction: c.direction, channel: c.channel, vendor: r.vendors.find((v) => v.id === c.vendorId)?.name, subject: c.subject, body: c.body.slice(0, 1200), status: c.status, at: c.createdAt })),
        budget: r.budget,
        approvals: r.approvals.filter((a) => a.roleId === ctx.roleId || a.status !== "pending").slice(-20),
        timeline: r.timeline,
        tasks: r.tasks.map((t) => ({ key: t.key, title: t.title, status: t.status, due: t.dueDate, output: t.output?.slice(0, 300) })),
      };
      return { result: section === "all" ? parts : { [section]: parts[section] } };
    },
  }),
  def({
    name: "search_vendors",
    description: "Find real local vendors/venues for a category (e.g. 'venue', 'caterer', 'dj', 'florist', 'photographer', 'party rentals', 'event security'). Results are saved to the event's vendor list.",
    schema: z.object({
      category: z.string(),
      query: z.string().optional().describe("Style/requirement hints, e.g. 'rooftop 150 guests', 'vegan', 'jazz trio'"),
      limit: z.number().int().min(1).max(10).optional(),
    }),
    async run(input, ctx) {
      const r = event(ctx);
      const found = await searchVendors({ category: input.category, city: r.blueprint?.city ?? r.brief.city, query: input.query, limit: input.limit });
      const fresh = found.filter((v) => !r.vendors.some((e) => e.name === v.name && e.category === v.category));
      await store.mutate(ctx.eventId, (rec) => { rec.vendors.push(...fresh); });
      const all = event(ctx).vendors.filter((v) => v.category === input.category);
      await store.log(ctx.eventId, ctx.roleId, "tool", `Found ${fresh.length} new ${input.category} options`);
      return { result: { vendors: all.map(vendorBrief) } };
    },
  }),
  def({
    name: "add_vendor",
    description: "Add a vendor you learned about elsewhere (host recommendation, venue's preferred list, referral).",
    schema: z.object({ name: z.string(), category: z.string(), email: z.string().optional(), phone: z.string().optional(), website: z.string().optional(), notes: z.string().optional() }),
    async run(input, ctx) {
      const v: Vendor = { id: uid("ven"), city: event(ctx).brief.city, source: "host_provided", ...input };
      await store.mutate(ctx.eventId, (r) => { r.vendors.push(v); });
      return { result: vendorBrief(v) };
    },
  }),
  def({
    name: "send_email",
    description: "Email a vendor (by vendor_id) or another party (by address). Write like a professional event planner: specific date, headcount, requirements, budget range when appropriate, and a clear ask. Never commit to a booking or payment in a message.",
    schema: z.object({ vendor_id: z.string().optional(), to: z.string().optional(), subject: z.string(), body: z.string() }),
    run: (input, ctx) => outbound(ctx, "email", input),
  }),
  def({
    name: "send_sms",
    description: "Text a vendor or contact. Keep it short and specific. Good for quick availability checks and day-of confirmations.",
    schema: z.object({ vendor_id: z.string().optional(), to: z.string().optional(), body: z.string().max(600) }),
    run: (input, ctx) => outbound(ctx, "sms", input),
  }),
  def({
    name: "place_call",
    description: "Phone a vendor. Provide the opening script (an AI disclosure is added automatically) and the goal of the call. The call transcript is logged and the vendor's answers come back as messages.",
    schema: z.object({ vendor_id: z.string().optional(), to: z.string().optional(), script: z.string(), goal: z.string() }),
    run: (input, ctx) => outbound(ctx, "voice", { vendor_id: input.vendor_id, to: input.to, subject: `Call: ${input.goal}`, body: input.script }),
  }),
  def({
    name: "record_quote",
    description: "Record a price/quote a vendor gave (from an email, text or call).",
    schema: z.object({ vendor_id: z.string(), amount: z.number(), description: z.string(), valid_until: z.string().optional() }),
    async run(input, ctx) {
      const r = event(ctx);
      const vendor = r.vendors.find((v) => v.id === input.vendor_id);
      if (!vendor) throw new Error("Unknown vendor_id");
      const quote = { id: uid("quo"), vendorId: vendor.id, category: vendor.category, amount: input.amount, currency: r.blueprint?.currency ?? "USD", description: input.description, validUntil: input.valid_until, status: "received" as const, receivedAt: nowIso() };
      await store.mutate(ctx.eventId, (rec) => { rec.quotes.push(quote); });
      return { result: { quote_id: quote.id } };
    },
  }),
  def({
    name: "request_approval",
    description: "Ask the host to approve a commitment: booking a vendor, paying a deposit, signing a contract, publishing public content, changing the budget, or making a decision between options. REQUIRED before any booking, payment or contract. After requesting, finish your task with complete_task(status='waiting_approval').",
    schema: z.object({
      kind: z.enum(["booking", "payment", "contract", "public_post", "budget_change", "decision"]),
      title: z.string(),
      details: z.string().describe("Your recommendation and the reasoning, alternatives considered, and key terms (deposit, cancellation)"),
      amount: z.number().optional(),
      vendor_id: z.string().optional(),
      quote_id: z.string().optional(),
      options: z.array(z.string()).optional().describe("For decisions: the choices the host can pick from"),
    }),
    async run(input, ctx) {
      const approval = await createApproval(ctx, { kind: input.kind, title: input.title, details: input.details, amount: input.amount, vendorId: input.vendor_id, quoteId: input.quote_id, options: input.options });
      return { result: { approval_id: approval.id, status: "pending" } };
    },
  }),
  def({
    name: "update_budget",
    description: "Add or update a budget line (estimates, committed amounts after approved bookings).",
    schema: z.object({ category: z.string(), description: z.string(), estimated: z.number().optional(), committed: z.number().optional(), vendor_id: z.string().optional() }),
    async run(input, ctx) {
      await store.mutate(ctx.eventId, (r) => {
        const line = r.budget.find((b) => b.category.toLowerCase() === input.category.toLowerCase());
        if (input.committed !== undefined) {
          const approved = r.approvals.some((a) => a.status === "approved" && (a.vendorId === input.vendor_id || a.kind === "budget_change"));
          if (input.committed > 0 && !approved) throw new Error("Cannot mark spend as committed without an approved booking/budget approval.");
        }
        if (line) {
          line.description = input.description;
          if (input.estimated !== undefined) line.estimated = input.estimated;
          if (input.committed !== undefined) line.committed = input.committed;
          if (input.vendor_id) line.vendorId = input.vendor_id;
        } else {
          r.budget.push({ id: uid("bud"), category: input.category, description: input.description, estimated: input.estimated ?? 0, committed: input.committed ?? 0, paid: 0, vendorId: input.vendor_id });
        }
      });
      return { result: { ok: true } };
    },
  }),
  def({
    name: "create_marketing_asset",
    description: "Draft marketing or guest communication content: invitations, email campaigns, social posts, press releases, landing page copy, ads, signage, SMS blasts. Public-facing assets go to the host for approval before publishing.",
    schema: z.object({
      kind: z.enum(["invitation", "email_campaign", "social_post", "press_release", "landing_page", "ad", "signage", "sms_blast"]),
      channel: z.string().describe("e.g. instagram, linkedin, email, website, print"),
      title: z.string(),
      content: z.string(),
      scheduled_for: z.string().optional(),
    }),
    async run(input, ctx) {
      const asset = { id: uid("mkt"), roleId: ctx.roleId, kind: input.kind, channel: input.channel, title: input.title, content: input.content, scheduledFor: input.scheduled_for, status: "pending_approval" as const };
      await store.mutate(ctx.eventId, (r) => { r.marketing.push(asset); });
      await createApproval(ctx, { kind: "public_post", title: `Publish ${input.kind.replace("_", " ")}: ${input.title}`, details: input.content, action: { type: "publish_asset", payload: { assetId: asset.id } } });
      return { result: { asset_id: asset.id, status: "pending_approval" } };
    },
  }),
  def({
    name: "add_timeline_item",
    description: "Add a planning milestone (when = YYYY-MM-DD) or a run-of-show entry (when = HH:MM on event day).",
    schema: z.object({ when: z.string(), title: z.string(), kind: z.enum(["milestone", "run_of_show"]), owner_role: z.string().optional(), notes: z.string().optional() }),
    async run(input, ctx) {
      await store.mutate(ctx.eventId, (r) => {
        r.timeline.push({ id: uid("tl"), when: input.when, title: input.title, kind: input.kind, owner: input.owner_role ?? ctx.roleId, notes: input.notes });
        r.timeline.sort((a, b) => a.when.localeCompare(b.when));
      });
      return { result: { ok: true } };
    },
  }),
  def({
    name: "log_risk",
    description: "Record a risk with a concrete mitigation (weather, vendor no-show, permit delay, overcapacity, allergy, etc.).",
    schema: z.object({ description: z.string(), likelihood: z.enum(["low", "medium", "high"]), impact: z.enum(["low", "medium", "high"]), mitigation: z.string() }),
    async run(input, ctx) {
      await store.mutate(ctx.eventId, (r) => { r.risks.push({ id: uid("rsk"), roleId: ctx.roleId, ...input }); });
      return { result: { ok: true } };
    },
  }),
  def({
    name: "message_host",
    description: "Send the host an update or a question (by email, or SMS for urgent items). Use sparingly and make it skimmable.",
    schema: z.object({ subject: z.string(), body: z.string(), urgent: z.boolean().optional() }),
    async run(input, ctx) {
      const r = event(ctx);
      const channel = input.urgent && r.brief.hostPhone ? "sms" : "email";
      const to = channel === "sms" ? r.brief.hostPhone! : r.brief.hostEmail;
      const comm = await comms.send({ event: r, roleId: ctx.roleId, channel, to, subject: input.subject, body: input.body });
      comm.threadKey = comms.threadKey(ctx.eventId, "host");
      await store.mutate(ctx.eventId, (rec) => { rec.communications.push(comm); });
      return { result: { sent: comm.status } };
    },
  }),
  def({
    name: "add_task",
    description: "Add a task you discovered (for yourself or hand off to another role by role_id). Use this so nothing falls through the cracks.",
    schema: z.object({ title: z.string(), description: z.string(), phase: phaseEnum, role_id: z.string().optional(), due_date: z.string().optional(), requires_approval: z.boolean().optional() }),
    async run(input, ctx) {
      const r = event(ctx);
      const roleId = input.role_id && r.roster.some((a) => a.roleId === input.role_id) ? input.role_id : ctx.roleId;
      const key = `${roleId}.custom_${uid("k").slice(2, 8)}`;
      await store.mutate(ctx.eventId, (rec) => {
        rec.tasks.push({ id: uid("tsk"), key, roleId, title: input.title, description: input.description, phase: input.phase, dueDate: input.due_date ?? null, dependsOn: [], status: "ready", requiresApproval: Boolean(input.requires_approval), attempts: 0, updatedAt: nowIso() });
      });
      return { result: { task_key: key, assigned_to: roleId } };
    },
  }),
  def({
    name: "complete_task",
    description: "Finish your work on the current task for now. status: 'done' (complete), 'waiting_vendor' (need replies), 'waiting_approval' (host must decide), 'blocked' (cannot proceed; explain).",
    schema: z.object({ status: z.enum(["done", "waiting_vendor", "waiting_approval", "blocked"]), summary: z.string().describe("What you did, what you found, what's next — written for the host") }),
    async run(input) {
      return { result: { ok: true }, stop: input.status, summary: input.summary };
    },
  }),
];

export type ToolName = (typeof TOOLS)[number]["name"];

/** Tool definitions for the Messages API. */
export function toolSpecs(): Anthropic.Beta.BetaTool[] {
  return TOOLS.map((t) => {
    const { $schema, ...schema } = z.toJSONSchema(t.schema) as Record<string, unknown>;
    return { name: t.name, description: t.description, input_schema: schema as Anthropic.Beta.BetaTool.InputSchema };
  });
}

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome & { isError?: boolean }> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { result: { error: `Unknown tool ${name}` }, isError: true };
  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) return { result: { error: "Invalid input", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, isError: true };
  try {
    return await (tool.run as (i: unknown, c: ToolContext) => Promise<ToolOutcome>)(parsed.data, ctx);
  } catch (err) {
    return { result: { error: (err as Error).message }, isError: true };
  }
}
