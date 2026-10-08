import { store } from "../store.js";
import type { MarketingAsset, Task } from "../types.js";
import { money } from "../util.js";
import { runTool, type ToolContext } from "./tools.js";
import type { AgentResult } from "./specialist.js";

/**
 * Offline agent behaviour, used when no Anthropic credentials are configured
 * (and in tests). It drives the same tools the LLM agents use, with simple
 * scripted judgement, so the full lifecycle — sourcing, quotes, approvals,
 * bookings, marketing, run-of-show, wrap-up — can be demonstrated and tested.
 */

const call = async (ctx: ToolContext, name: string, input: unknown) => {
  const out = await runTool(name, input, ctx);
  await store.log(ctx.eventId, ctx.roleId, out.isError ? "error" : "tool", `${name}${out.isError ? " failed: " + JSON.stringify(out.result) : ""}`);
  return out.result as any;
};

const ASSET_FOR: Record<string, MarketingAsset["kind"]> = {
  save_the_date: "invitation", invitations: "invitation", email_campaigns: "email_campaign", social_calendar: "social_post",
  press_release: "press_release", registration_page: "landing_page", thank_yous: "email_campaign",
};

export async function simulateTask(eventId: string, task: Task): Promise<AgentResult> {
  const ctx: ToolContext = { eventId, roleId: task.roleId, taskId: task.id };
  const rec = store.get(eventId)!;
  const bp = rec.blueprint!;
  const cur = bp.currency;
  const shortKey = task.key.split(".")[1];
  const approvals = rec.approvals.filter((a) => a.taskId === task.id);
  const approved = approvals.find((a) => a.status === "approved");
  const rejected = approvals.filter((a) => a.status === "rejected");
  const pending = approvals.find((a) => a.status === "pending");
  if (pending) return { status: "waiting_approval", summary: `Waiting on host: ${pending.title}` };

  // ── Booking tasks: pick the best quote, ask the host, then confirm. ──
  if (task.requiresApproval && task.vendorCategory) {
    if (approved) {
      const vendor = rec.vendors.find((v) => v.id === approved.vendorId);
      if (vendor) {
        await call(ctx, "send_email", { vendor_id: vendor.id, subject: `Confirming booking for ${bp.title}`, body: `Hi ${vendor.name},\n\nThe host has approved your proposal of ${money(approved.amount ?? 0, cur)} for ${bp.date ?? "the event date"}. Please send the contract and deposit invoice and we'll get it signed.\n\nThank you!\nEventifyre (AI assistant for ${rec.brief.hostName})` });
        await call(ctx, "update_budget", { category: matchBudgetCategory(task.vendorCategory, bp.budgetAllocation.map((a) => a.category)), description: `${vendor.name} (booked)`, committed: approved.amount ?? 0, vendor_id: vendor.id });
      }
      return { status: "done", summary: `Booked ${vendor?.name ?? "vendor"} for ${money(approved.amount ?? 0, cur)} after host approval; contract and deposit invoice requested.` };
    }
    let quotes = rec.quotes.filter((q) => q.category === task.vendorCategory && !rejected.some((r) => r.quoteId === q.id));
    if (quotes.length === 0) {
      await sourceQuotes(ctx, task.vendorCategory, bp.city);
      quotes = store.get(eventId)!.quotes.filter((q) => q.category === task.vendorCategory && !rejected.some((r) => r.quoteId === q.id));
    }
    if (quotes.length === 0) return { status: "blocked", summary: `No available ${task.vendorCategory} options found; widening the search needs host input.` };
    const ranked = [...quotes].sort((a, b) => a.amount - b.amount);
    const pick = ranked[Math.min(1, ranked.length - 1)]; // second-cheapest: value over rock-bottom
    const vendor = store.get(eventId)!.vendors.find((v) => v.id === pick.vendorId)!;
    const alts = ranked.filter((q) => q.id !== pick.id).slice(0, 3).map((q) => `${store.get(eventId)!.vendors.find((v) => v.id === q.vendorId)?.name}: ${money(q.amount, cur)}`);
    await call(ctx, "request_approval", {
      kind: "booking", title: `Book ${vendor.name} (${task.vendorCategory}) for ${money(pick.amount, cur)}`,
      details: `Recommendation: ${vendor.name} — rating ${vendor.rating ?? "n/a"}, quote ${money(pick.amount, cur)} (30% deposit to hold the date).\nAlternatives: ${alts.join("; ") || "none"}.`,
      amount: pick.amount, vendor_id: vendor.id, quote_id: pick.id,
    });
    return { status: "waiting_approval", summary: `Recommended ${vendor.name} at ${money(pick.amount, cur)}; awaiting host approval.` };
  }

  // ── Sourcing tasks: find vendors, contact three, record quotes. ──
  if (task.vendorCategory) {
    const n = await sourceQuotes(ctx, task.vendorCategory, bp.city);
    return { status: "done", summary: `Contacted ${task.vendorCategory} options and collected ${n} quote(s).` };
  }

  // ── Content that needs approval: draft it, send it after approval. ──
  if (task.requiresApproval) {
    if (approved) return { status: "done", summary: `Host approved "${approved.title}". Scheduled/sent.` };
    if (rejected.length && task.attempts > 3) return { status: "blocked", summary: "Host rejected the drafts; waiting for direction." };
    const kind = ASSET_FOR[shortKey];
    if (kind) {
      await call(ctx, "create_marketing_asset", { kind, channel: kind === "social_post" ? "instagram" : "email", title: `${task.title} — ${bp.title}`, content: draftCopy(kind, bp.title, bp.date, bp.city, rec.brief.hostName) });
    } else {
      await call(ctx, "request_approval", { kind: "decision", title: task.title, details: `${task.description}\n\nProposed plan prepared by the ${task.roleId.replace(/_/g, " ")} agent based on the blueprint.` });
    }
    return { status: "waiting_approval", summary: `Drafted "${task.title}" for host review.` };
  }

  // ── Everything else: produce what the task describes. ──
  switch (shortKey) {
    case "host_kickoff":
      await call(ctx, "message_host", { subject: `Your event "${bp.title}" is in motion`, body: `Hi ${rec.brief.hostName},\n\nYour AI event team is staffed (${rec.roster.length} agents) and working. Budget: ${money(bp.budget, cur)} for ${bp.guestCount} guests.\n\nOpen questions:\n${bp.openQuestions.map((q) => `• ${q}`).join("\n") || "• None — we have what we need."}\n\nYou'll get approval requests before anything is booked or paid.` });
      break;
    case "run_of_show": {
      const start = 18 * 60;
      const moments = bp.experienceMoments.length ? bp.experienceMoments : ["Doors open", "Main program", "Dinner", "Highlight", "Close"];
      const step = Math.max(20, Math.round((bp.durationHours * 60) / (moments.length + 1)));
      const slots: [string, number][] = [
        ["Vendor load-in & setup", -180],
        ["Final walkthrough with all leads", -45],
        ...moments.map((m, i) => [m, i * step] as [string, number]),
        ["Load-out & venue walkthrough", bp.durationHours * 60],
      ];
      for (const [title, offset] of slots) {
        const t = start + offset;
        const hhmm = `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
        await call(ctx, "add_timeline_item", { when: hhmm, title, kind: "run_of_show" });
      }
      break;
    }
    case "risk_assessment":
    case "weather_plan":
    case "permit_audit":
      await call(ctx, "log_risk", { description: shortKey === "permit_audit" ? "Permit approval lead times may exceed the planning window" : shortKey === "weather_plan" ? "Adverse weather on event day" : `Crowd and safety risks for ${bp.guestCount} guests`, likelihood: "medium", impact: "high", mitigation: shortKey === "weather_plan" ? "Hold a tent/indoor backup with a go/no-go decision 72h before" : "Start applications now; keep a compliant fallback plan" });
      break;
    case "budget_plan":
      break; // budget lines were created by the planner
  }
  return { status: "done", summary: `${task.title}: completed by the ${task.roleId.replace(/_/g, " ")} agent.` };
}

async function sourceQuotes(ctx: ToolContext, category: string, city: string): Promise<number> {
  const found = await call(ctx, "search_vendors", { category, query: city, limit: 4 });
  const vendors = ((found?.vendors ?? []) as { id: string; name: string; hasEmail: boolean; hasPhone: boolean }[]).slice(0, 3);
  const rec = store.get(ctx.eventId)!;
  const bp = rec.blueprint!;
  let quotes = 0;
  for (const v of vendors) {
    const channel = v.hasEmail ? "send_email" : "send_sms";
    const res = await call(ctx, channel, {
      vendor_id: v.id,
      subject: `Availability & quote: ${bp.title} on ${bp.date ?? "a date TBD"}`,
      body: `Hello ${v.name},\n\nI'm an AI assistant planning an event for ${rec.brief.hostName}: ${bp.guestCount} guests in ${bp.city} on ${bp.date ?? "a date to be confirmed"}. Theme: ${bp.theme}.\nAre you available, and could you share pricing for ${category}?\n\nThank you!`,
    });
    const reply: string | undefined = res?.vendor_reply;
    const amount = reply ? Number(/(?:USD|[A-Z]{3}) ([\d,]+)/.exec(reply)?.[1]?.replace(/,/g, "")) : NaN;
    if (Number.isFinite(amount) && amount > 0) {
      await call(ctx, "record_quote", { vendor_id: v.id, amount, description: `${category} package` });
      quotes++;
    }
  }
  return quotes;
}

function matchBudgetCategory(vendorCategory: string, categories: string[]): string {
  const v = vendorCategory.toLowerCase();
  return categories.find((c) => c.toLowerCase().includes(v.split(" ")[0].slice(0, 5))) ?? vendorCategory;
}

function draftCopy(kind: MarketingAsset["kind"], title: string, date: string | null, city: string, host: string): string {
  const when = date ?? "soon";
  switch (kind) {
    case "invitation": return `You're invited to ${title}!\n${when} · ${city}\nHosted by ${host}. Kindly RSVP and let us know about any dietary or accessibility needs.`;
    case "social_post": return `Something special is coming to ${city} on ${when}: ${title}. Save the date ✨ #${title.replace(/[^a-z0-9]/gi, "").slice(0, 20)}`;
    case "press_release": return `FOR IMMEDIATE RELEASE — ${host} presents ${title}, ${when} in ${city}. [Details, quotes and media contact]`;
    case "landing_page": return `${title}\n${when} · ${city}\nGrab your spot before it sells out.`;
    default: return `${title} — ${when} in ${city}. More details inside.`;
  }
}
