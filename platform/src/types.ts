/**
 * Core domain model for Eventifyre.
 *
 * An Event starts life as a Brief (questionnaire answers + the host's vision in
 * natural language). The Event Director agent turns that into a Blueprint, the
 * Planner maps every human role a real production would need onto an AI agent,
 * and each agent works its Tasks: finding vendors, emailing / texting / calling
 * them, collecting quotes, asking the host for approval before money moves,
 * marketing the event, and running the day itself.
 */

export type Phase =
  | "concept"      // vision, goals, theme, budget frame
  | "planning"     // timeline, budget, guest strategy, permits
  | "sourcing"     // find + contact vendors, gather quotes
  | "booking"      // negotiate, approve, contract, deposit
  | "promotion"    // marketing, invitations, ticketing, PR
  | "preparation"  // logistics, run-of-show, rehearsals, confirmations
  | "execution"    // event day operations
  | "wrapup";      // payments, thank-yous, feedback, report

export const PHASES: Phase[] = [
  "concept", "planning", "sourcing", "booking", "promotion", "preparation", "execution", "wrapup",
];

export type Channel = "email" | "sms" | "voice" | "internal";

export interface Brief {
  hostName: string;
  hostEmail: string;
  hostPhone?: string;
  organization?: string;
  /** Free text: "a 1920s gatsby-style 40th birthday on a rooftop with jazz…" */
  vision: string;
  eventType?: string;
  date?: string;            // ISO date, may be flexible
  dateFlexible?: boolean;
  city: string;
  guestCount?: number;
  budget?: number;
  currency?: string;
  venuePreference?: string; // indoor / outdoor / specific venue / home
  mustHaves?: string;
  dealBreakers?: string;
  audience?: string;        // who attends; for marketing
  ticketed?: boolean;
  accessibilityNeeds?: string;
  dietaryNeeds?: string;
  brandAssets?: string;
  /** How much the agents may do without asking: see AutonomyLevel. */
  autonomy?: AutonomyLevel;
}

/**
 * - "approve_all": every outbound message and every commitment needs approval
 * - "approve_commitments": agents may contact vendors freely; bookings,
 *    payments, contracts and public posts need approval (default)
 * - "budget_guardrails": agents may commit spend within approved budget lines
 *    up to a per-item ceiling; anything above needs approval
 */
export type AutonomyLevel = "approve_all" | "approve_commitments" | "budget_guardrails";

export interface Blueprint {
  title: string;
  eventType: string;
  summary: string;
  theme: string;
  goals: string[];
  date: string | null;
  durationHours: number;
  city: string;
  guestCount: number;
  budget: number;
  currency: string;
  venueRequirements: string[];
  experienceMoments: string[];      // key moments of the guest journey
  styleKeywords: string[];
  audience: string;
  ticketed: boolean;
  constraints: string[];
  openQuestions: string[];          // things the director still needs from the host
  budgetAllocation: { category: string; percent: number }[];
}

export interface RoleDefinition {
  id: string;
  title: string;          // the human job this agent replaces, e.g. "Venue Scout"
  department: string;     // Leadership, Production, Guest Experience, Marketing…
  mission: string;
  responsibilities: string[];
  channels: Channel[];    // how this role talks to the outside world
  vendorCategories: string[];
  /** Event types where this role is always staffed. "*" = all. */
  coreFor: string[];
  /** Event types where this role is staffed when the brief hints at it. */
  optionalFor: string[];
  /** Keywords in the vision/brief that activate this role. */
  triggers: string[];
  tasks: TaskTemplate[];
}

export interface TaskTemplate {
  key: string;
  title: string;
  description: string;
  phase: Phase;
  /** Days before the event this should be done by (negative = after event). */
  dueDaysBefore: number;
  dependsOn?: string[];   // "roleId.taskKey" or "taskKey" within same role
  requiresApproval?: boolean;
  vendorCategory?: string;
}

export type TaskStatus = "pending" | "ready" | "in_progress" | "waiting_vendor" | "waiting_approval" | "done" | "blocked" | "skipped";

export interface Task {
  id: string;
  key: string;            // roleId.taskKey
  roleId: string;
  title: string;
  description: string;
  phase: Phase;
  dueDate: string | null;
  dependsOn: string[];    // task keys
  status: TaskStatus;
  requiresApproval: boolean;
  vendorCategory?: string;
  output?: string;        // agent's summary of what was done
  attempts: number;
  updatedAt: string;
}

export interface AgentAssignment {
  roleId: string;
  title: string;
  department: string;
  mission: string;
  reason: string;         // why this role is staffed for this event
  status: "idle" | "working" | "waiting" | "done";
}

export type VendorSource = "google_places" | "directory" | "simulated" | "host_provided";

export interface Vendor {
  id: string;
  name: string;
  category: string;
  city: string;
  email?: string;
  phone?: string;
  website?: string;
  rating?: number;
  priceLevel?: number;     // 1-4
  notes?: string;
  source: VendorSource;
  doNotContact?: boolean;  // opted out (e.g. replied STOP)
}

export interface Quote {
  id: string;
  vendorId: string;
  category: string;
  amount: number;
  currency: string;
  description: string;
  validUntil?: string;
  status: "requested" | "received" | "shortlisted" | "accepted" | "declined";
  receivedAt: string;
}

export interface Communication {
  id: string;
  eventId: string;
  roleId: string;
  vendorId?: string;
  channel: Channel;
  direction: "outbound" | "inbound";
  to?: string;
  from?: string;
  subject?: string;
  body: string;
  status: "draft" | "pending_approval" | "sent" | "delivered" | "failed" | "received" | "simulated";
  provider?: string;
  providerId?: string;
  threadKey: string;       // groups a conversation with one vendor
  createdAt: string;
}

export type ApprovalKind = "booking" | "payment" | "contract" | "outbound_message" | "public_post" | "budget_change" | "decision";

export interface Approval {
  id: string;
  eventId: string;
  roleId: string;
  taskId?: string;
  kind: ApprovalKind;
  title: string;
  details: string;
  amount?: number;
  vendorId?: string;
  quoteId?: string;
  options?: string[];
  /** Payload executed when approved (e.g. the message to send). */
  action?: { type: string; payload: Record<string, unknown> };
  status: "pending" | "approved" | "rejected";
  decisionNote?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface BudgetLine {
  id: string;
  category: string;
  description: string;
  estimated: number;
  committed: number;
  paid: number;
  vendorId?: string;
}

export interface TimelineItem {
  id: string;
  /** "T-30d" style planning milestone or an HH:MM run-of-show slot. */
  when: string;
  title: string;
  owner: string;           // roleId
  kind: "milestone" | "run_of_show";
  notes?: string;
}

export interface MarketingAsset {
  id: string;
  roleId: string;
  kind: "invitation" | "email_campaign" | "social_post" | "press_release" | "landing_page" | "ad" | "signage" | "sms_blast";
  channel: string;
  title: string;
  content: string;
  scheduledFor?: string;
  status: "draft" | "pending_approval" | "approved" | "published";
}

export interface Risk {
  id: string;
  roleId: string;
  description: string;
  likelihood: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  mitigation: string;
}

export interface ActivityEntry {
  id: string;
  at: string;
  roleId: string;
  kind: "thought" | "action" | "tool" | "message" | "approval" | "status" | "error";
  text: string;
}

export interface EventRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "drafting" | "planning" | "running" | "paused" | "awaiting_host" | "scheduled" | "completed" | "failed";
  /**
   * Demo/testing switch: ignore the calendar so preparation, event-day and
   * wrap-up tasks run immediately instead of waiting for their dates.
   */
  fastForward?: boolean;
  error?: string;
  brief: Brief;
  blueprint?: Blueprint;
  roster: AgentAssignment[];
  tasks: Task[];
  vendors: Vendor[];
  quotes: Quote[];
  communications: Communication[];
  approvals: Approval[];
  budget: BudgetLine[];
  timeline: TimelineItem[];
  marketing: MarketingAsset[];
  risks: Risk[];
  activity: ActivityEntry[];
}
