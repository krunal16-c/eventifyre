import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Configure before the store is constructed (modules are imported dynamically below).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "eventifyre-test-"));
process.env.EVENTIFYRE_OFFLINE = "true";
delete process.env.COMMS_LIVE;

const { heuristicBlueprint } = await import("../src/agents/director.js");
const { buildPlan, staffRoles } = await import("../src/agents/planner.js");
const { store } = await import("../src/store.js");
const orchestrator = await import("../src/orchestrator.js");
const { runTool } = await import("../src/agents/tools.js");
const { ROLES } = await import("../src/catalog/roles.js");
import type { Brief } from "../src/types.js";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const base: Brief = { hostName: "Sam", hostEmail: "sam@example.com", city: "Austin, TX", vision: "" };

async function waitFor(pred: () => boolean, ms = 20_000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

test("catalog: every task dependency points at a real role/task", () => {
  const keys = new Set(ROLES.flatMap((r) => r.tasks.map((t) => `${r.id}.${t.key}`)));
  for (const role of ROLES) for (const t of role.tasks) for (const d of t.dependsOn ?? []) {
    const full = d.includes(".") ? d : `${role.id}.${d}`;
    assert.ok(keys.has(full), `${role.id}.${t.key} depends on missing ${full}`);
  }
});

test("staffing: weddings get ceremony, florals and photo; core roles always present", () => {
  const brief = { ...base, vision: "Our garden wedding with 150 guests, string lights and a string quartet for the ceremony" };
  const ids = staffRoles(heuristicBlueprint(brief), brief).map((s) => s.role.id);
  for (const id of ["event_director", "venue_scout", "catering_manager", "legal_compliance", "accessibility_inclusion", "ceremony_officiant", "florist", "photo_video", "day_of_coordinator", "post_event"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  assert.ok(!ids.includes("ticketing_registration"));
});

test("staffing: ticketed conference gets marketing, ticketing, speakers and sponsorship", () => {
  const brief = { ...base, vision: "A 400-person developer conference with keynotes and sponsors", ticketed: true, guestCount: 400 };
  const ids = staffRoles(heuristicBlueprint(brief), brief).map((s) => s.role.id);
  for (const id of ["marketing_strategist", "ticketing_registration", "program_manager", "sponsorship_fundraising", "security_safety", "social_media"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

test("planning: short lead times are compressed and nothing is due in the past", () => {
  const brief = { ...base, vision: "Surprise birthday party with a DJ", date: inDays(20) };
  const plan = buildPlan(heuristicBlueprint(brief), brief);
  const today = new Date().toISOString().slice(0, 10);
  for (const t of plan.tasks) {
    if (!t.dueDate) continue;
    assert.ok(t.dueDate >= today, `${t.key} due ${t.dueDate}`);
    if (t.phase !== "wrapup") assert.ok(t.dueDate <= brief.date!, `${t.key} due after the event`);
  }
  assert.ok(plan.tasks.some((t) => t.status === "ready"), "something can start immediately");
  const budgetTotal = plan.budget.reduce((s, b) => s + b.estimated, 0);
  assert.ok(Math.abs(budgetTotal - heuristicBlueprint(brief).budget) < 50);
});

test("lifecycle: agents run an event end to end with host approvals", { timeout: 90_000 }, async () => {
  const rec = await orchestrator.createEvent({ ...base, vision: "Company holiday party for 60 people with a DJ and an open bar", date: inDays(45), budget: 12000, guestCount: 60 }, { fastForward: true });
  await waitFor(() => (store.get(rec.id)?.approvals.length ?? 0) > 0);
  const booking = store.get(rec.id)!.approvals.find((a) => a.kind === "booking");
  assert.ok(booking, "a booking approval is requested");
  // Agents must not commit money before approval.
  assert.equal(store.get(rec.id)!.budget.reduce((s, b) => s + b.committed, 0), 0);

  // Play the host: approve everything until the event completes (deadline, not iteration count, so a busy CI box doesn't flake).
  const deadline = Date.now() + 60_000;
  while (store.get(rec.id)!.status !== "completed" && Date.now() < deadline) {
    for (const a of store.get(rec.id)!.approvals.filter((x) => x.status === "pending")) await orchestrator.decideApproval(rec.id, a.id, true);
    await new Promise((r) => setTimeout(r, 25));
  }
  const final = store.get(rec.id)!;
  assert.equal(final.status, "completed");
  assert.ok(final.tasks.every((t) => t.status === "done"));
  assert.ok(final.communications.some((c) => c.direction === "outbound" && c.status === "simulated"));
  assert.ok(final.quotes.length > 0 && final.timeline.some((t) => t.kind === "run_of_show"));
  assert.ok(final.budget.reduce((s, b) => s + b.committed, 0) > 0);
});

test("autonomy: approve_all queues outbound messages for the host instead of sending", async () => {
  const rec = store.create({ ...base, vision: "Book club dinner", autonomy: "approve_all" });
  await store.mutate(rec.id, (r) => { r.vendors.push({ id: "ven_x", name: "Test Bistro", category: "caterer", city: "Austin", email: "hi@bistro.example.com", source: "simulated" }); });
  const ctx = { eventId: rec.id, roleId: "catering_manager", taskId: "tsk_none" };
  const out = await runTool("send_email", { vendor_id: "ven_x", subject: "Hello", body: "Are you free?" }, ctx);
  assert.ok(!out.isError);
  assert.equal(store.get(rec.id)!.communications.length, 0);
  assert.equal(store.get(rec.id)!.approvals[0].kind, "outbound_message");
});

test("tools: invalid input and uncommitted spend are rejected", async () => {
  const rec = store.create({ ...base, vision: "Meetup" });
  const ctx = { eventId: rec.id, roleId: "finance_manager", taskId: "tsk_none" };
  const bad = await runTool("record_quote", { vendor_id: 42 }, ctx);
  assert.equal(bad.isError, true);
  const spend = await runTool("update_budget", { category: "Venue", description: "sneaky", committed: 5000, vendor_id: "ven_nope" }, ctx);
  assert.equal(spend.isError, true);
});

test("inbound: STOP marks the vendor do-not-contact and further outreach is refused", async () => {
  const rec = store.create({ ...base, vision: "Meetup" });
  await store.mutate(rec.id, (r) => {
    r.vendors.push({ id: "ven_stop", name: "Loud DJs", category: "dj", city: "Austin", phone: "+15550100", source: "simulated" });
    r.communications.push({ id: "m1", eventId: r.id, roleId: "entertainment_booker", vendorId: "ven_stop", channel: "sms", direction: "outbound", to: "+15550100", body: "hi", status: "sent", threadKey: `${r.id}:ven_stop`, createdAt: new Date().toISOString() });
  });
  await orchestrator.handleInbound({ channel: "sms", from: "+15550100", body: "STOP", provider: "test" });
  assert.equal(store.get(rec.id)!.vendors[0].doNotContact, true);
  const again = await runTool("send_sms", { vendor_id: "ven_stop", body: "still there?" }, { eventId: rec.id, roleId: "entertainment_booker", taskId: "t" });
  assert.equal(again.isError, true);
});
