import { ROLES } from "../catalog/roles.js";
import type { AgentAssignment, Blueprint, BudgetLine, Brief, RoleDefinition, Task, TimelineItem } from "../types.js";
import { addDays, daysBetween, nowIso, uid } from "../util.js";

/**
 * Planner: maps every person a production needs onto an AI agent, then lays
 * out each agent's tasks on a dependency graph with due dates worked
 * backwards from the event date. Deterministic, so the plan is explainable
 * and testable; agents can add tasks later as they discover new work.
 */

export interface Plan {
  roster: AgentAssignment[];
  tasks: Task[];
  budget: BudgetLine[];
  timeline: TimelineItem[];
}

/** Words in the brief that explicitly ask for something staff a role regardless of event type. */
function mentions(text: string, trigger: string): boolean {
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(text);
}

export function staffRoles(blueprint: Blueprint, brief: Brief): { role: RoleDefinition; reason: string }[] {
  const text = [brief.vision, brief.mustHaves, brief.venuePreference, brief.accessibilityNeeds, brief.audience,
    blueprint.summary, blueprint.theme, ...blueprint.experienceMoments, ...blueprint.venueRequirements].filter(Boolean).join(" \n ");
  const type = blueprint.eventType;
  const staffed: { role: RoleDefinition; reason: string }[] = [];

  for (const role of ROLES) {
    let reason: string | null = null;
    if (role.coreFor.includes("*")) reason = "Core role for every event";
    else if (role.coreFor.includes(type)) reason = `Core role for ${type.replace(/_/g, " ")} events`;
    else {
      const hit = role.triggers.find((tr) => mentions(text, tr));
      if (hit) reason = `Your brief mentions “${hit}”`;
    }
    if (!reason && role.id === "ticketing_registration" && blueprint.ticketed) reason = "Event is ticketed";
    if (!reason && role.id === "marketing_strategist" && blueprint.ticketed) reason = "Ticketed events need demand generation";
    if (!reason && role.id === "security_safety" && blueprint.guestCount >= 300) reason = `Crowd of ${blueprint.guestCount} needs a safety plan`;
    if (!reason && role.id === "staffing_manager" && blueprint.guestCount >= 250) reason = `${blueprint.guestCount} guests need floor staff`;
    if (!reason && role.id === "hospitality_travel" && blueprint.durationHours > 12) reason = "Multi-day event needs lodging";
    if (reason) staffed.push({ role, reason });
  }
  return staffed;
}

export function buildPlan(blueprint: Blueprint, brief: Brief, today = nowIso().slice(0, 10)): Plan {
  const staffed = staffRoles(blueprint, brief);
  const staffedIds = new Set(staffed.map((s) => s.role.id));

  const roster: AgentAssignment[] = staffed.map(({ role, reason }) => ({
    roleId: role.id, title: role.title, department: role.department, mission: role.mission, reason, status: "idle",
  }));

  // Compress lead times when the event is sooner than an ideal schedule.
  const maxLead = Math.max(...staffed.flatMap((s) => s.role.tasks.map((t) => t.dueDaysBefore)).filter((d) => d < 900), 1);
  const daysUntil = blueprint.date ? daysBetween(today, blueprint.date) : null;
  const scale = daysUntil !== null ? Math.max(0, Math.min(1, (daysUntil - 1) / maxLead)) : 1;

  const tasks: Task[] = [];
  for (const { role } of staffed) {
    for (const tpl of role.tasks) {
      const key = `${role.id}.${tpl.key}`;
      const deps = (tpl.dependsOn ?? [])
        .map((d) => (d.includes(".") ? d : `${role.id}.${d}`))
        .filter((d) => staffedIds.has(d.split(".")[0]));
      let dueDate: string | null = null;
      if (tpl.dueDaysBefore >= 900) dueDate = today;
      else if (blueprint.date) {
        const before = tpl.dueDaysBefore > 0 ? Math.round(tpl.dueDaysBefore * scale) : tpl.dueDaysBefore;
        dueDate = addDays(blueprint.date, -before);
        if (dueDate < today) dueDate = today;
      }
      tasks.push({
        id: uid("tsk"), key, roleId: role.id, title: tpl.title, description: tpl.description, phase: tpl.phase,
        dueDate, dependsOn: deps, status: "pending", requiresApproval: Boolean(tpl.requiresApproval),
        vendorCategory: tpl.vendorCategory, attempts: 0, updatedAt: nowIso(),
      });
    }
  }
  // Drop dependencies on tasks that don't exist (e.g. template keys from unstaffed roles).
  const keys = new Set(tasks.map((t) => t.key));
  for (const task of tasks) {
    task.dependsOn = task.dependsOn.filter((d) => keys.has(d));
    if (task.dependsOn.length === 0) task.status = "ready";
  }

  const budget: BudgetLine[] = blueprint.budgetAllocation.map((a) => ({
    id: uid("bud"), category: a.category, description: `${a.percent}% of total`,
    estimated: Math.round((blueprint.budget * a.percent) / 100), committed: 0, paid: 0,
  }));

  const timeline: TimelineItem[] = [];
  if (blueprint.date) {
    const milestones: [number, string, string][] = [
      [Math.round(150 * scale), "Venue booked", "venue_scout"],
      [Math.round(75 * scale), "Core vendors booked (catering, AV, entertainment)", "event_director"],
      [Math.round(45 * scale), "Invitations out / registration live", "guest_manager"],
      [Math.round(14 * scale), "Run-of-show locked", "day_of_coordinator"],
      [Math.round(3 * scale), "All vendors reconfirmed", "logistics_manager"],
      [0, "Event day", "day_of_coordinator"],
      [-7, "Vendors paid & thank-yous sent", "post_event"],
    ];
    for (const [d, title, owner] of milestones) {
      if (owner !== "event_director" && !staffedIds.has(owner)) continue;
      timeline.push({ id: uid("tl"), when: addDays(blueprint.date, -d), title, owner, kind: "milestone" });
    }
  }

  return { roster, tasks, budget, timeline };
}
