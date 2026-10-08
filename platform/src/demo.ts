/**
 * End-to-end demo: submit a brief, let the agents work, play the host by
 * approving everything, and print what the AI team did.
 *
 *   npm run demo                      # offline simulator, simulated comms
 *   ANTHROPIC_API_KEY=... npm run demo  # live Claude agents, simulated comms
 */
import { store } from "./store.js";
import { createEvent, decideApproval } from "./orchestrator.js";
import { money } from "./util.js";
import type { Brief } from "./types.js";

const brief: Brief = {
  hostName: "Priya Shah",
  hostEmail: "priya@example.com",
  vision: "A 1920s Gatsby-style 40th birthday on a rooftop for about 80 friends. Live jazz trio, champagne tower, art-deco decor, " +
    "a photographer, great food with lots of vegetarian options, and I want everyone dancing by 10pm.",
  city: "Toronto, ON",
  date: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10),
  guestCount: 80,
  budget: 25000,
  currency: "CAD",
  dietaryNeeds: "Vegetarian options, one nut allergy",
  autonomy: "approve_commitments",
};

const idle = () => new Promise((r) => setTimeout(r, 200));

async function main() {
  const { id } = await createEvent(brief, { fastForward: true });
  for (let i = 0; i < 600; i++) {
    await idle();
    const rec = store.get(id)!;
    for (const a of rec.approvals.filter((x) => x.status === "pending")) {
      console.log(`  ✔ host approves: ${a.title}`);
      await decideApproval(id, a.id, true, "Looks good");
    }
    if (rec.status === "completed" || rec.status === "failed") break;
  }
  const rec = store.get(id)!;
  const bp = rec.blueprint!;
  console.log(`\n${bp.title} — ${bp.eventType}, ${bp.guestCount} guests, ${money(bp.budget, bp.currency)} · status: ${rec.status}`);
  console.log(`\nAI team (${rec.roster.length} agents):`);
  for (const a of rec.roster) console.log(`  • ${a.title} — ${a.reason}`);
  const done = rec.tasks.filter((t) => t.status === "done").length;
  console.log(`\nTasks: ${done}/${rec.tasks.length} done`);
  for (const t of rec.tasks.filter((t) => t.status !== "done")) console.log(`  ! ${t.key}: ${t.status} ${t.output ?? ""}`);
  console.log(`Vendors found: ${rec.vendors.length} · quotes: ${rec.quotes.length} · messages: ${rec.communications.length} · approvals: ${rec.approvals.length}`);
  const committed = rec.budget.reduce((s, b) => s + b.committed, 0);
  console.log(`Committed spend: ${money(committed, bp.currency)} of ${money(bp.budget, bp.currency)}`);
  console.log(`Run of show:`);
  for (const t of rec.timeline.filter((x) => x.kind === "run_of_show")) console.log(`  ${t.when}  ${t.title}`);
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
