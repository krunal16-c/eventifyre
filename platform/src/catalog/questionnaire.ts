import { EVENT_TYPES } from "./eventTypes.js";

/**
 * The intake questionnaire. Only the vision, city and contact are required —
 * everything else sharpens the plan, and the Event Director fills the gaps
 * (listing anything it had to assume as an open question for the host).
 */
export interface Question {
  id: string;
  label: string;
  help?: string;
  type: "text" | "textarea" | "email" | "tel" | "date" | "number" | "select" | "checkbox";
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  section: "vision" | "basics" | "guests" | "details" | "contact" | "autonomy";
}

export const QUESTIONNAIRE: Question[] = [
  { id: "vision", section: "vision", type: "textarea", required: true, label: "Describe your event in your own words",
    help: "What's the occasion, the vibe, the moments you're picturing, what would make it unforgettable?",
    placeholder: "A 1920s Gatsby-style 40th birthday on a rooftop for ~80 friends. Live jazz trio, champagne tower, art-deco decor, great food with vegetarian options. I want people dancing by 10pm." },
  { id: "eventType", section: "basics", type: "select", label: "Type of event", help: "Leave on auto-detect if unsure.",
    options: [{ value: "auto", label: "Auto-detect from my description" }, ...EVENT_TYPES.map((t) => ({ value: t.id, label: t.label })), { value: "custom", label: "Something else" }] },
  { id: "date", section: "basics", type: "date", label: "Event date" },
  { id: "dateFlexible", section: "basics", type: "checkbox", label: "My date is flexible" },
  { id: "city", section: "basics", type: "text", required: true, label: "City / area", placeholder: "Toronto, ON" },
  { id: "venuePreference", section: "basics", type: "text", label: "Venue preference", placeholder: "Rooftop, garden, my home, a specific venue…" },
  { id: "guestCount", section: "guests", type: "number", label: "Approximate number of guests" },
  { id: "audience", section: "guests", type: "text", label: "Who's attending?", placeholder: "Close friends & family / industry professionals / the public" },
  { id: "ticketed", section: "guests", type: "checkbox", label: "This is a public or ticketed event (we'll market it and sell tickets)" },
  { id: "budget", section: "details", type: "number", label: "Total budget" },
  { id: "currency", section: "details", type: "select", label: "Currency",
    options: ["USD", "CAD", "EUR", "GBP", "INR", "AUD", "AED", "SGD"].map((c) => ({ value: c, label: c })) },
  { id: "mustHaves", section: "details", type: "textarea", label: "Must-haves", placeholder: "Live band, open bar, photo booth, a specific caterer…" },
  { id: "dealBreakers", section: "details", type: "textarea", label: "Deal-breakers / things to avoid" },
  { id: "dietaryNeeds", section: "details", type: "text", label: "Dietary needs", placeholder: "Vegetarian, halal, nut allergy…" },
  { id: "accessibilityNeeds", section: "details", type: "text", label: "Accessibility needs", placeholder: "Wheelchair access, ASL, quiet room…" },
  { id: "brandAssets", section: "details", type: "text", label: "Brand / style references", placeholder: "Links to Pinterest boards, brand guide, colors" },
  { id: "hostName", section: "contact", type: "text", required: true, label: "Your name" },
  { id: "hostEmail", section: "contact", type: "email", required: true, label: "Email" },
  { id: "hostPhone", section: "contact", type: "tel", label: "Mobile (for urgent approvals by SMS)" },
  { id: "organization", section: "contact", type: "text", label: "Organization (optional)" },
  { id: "autonomy", section: "autonomy", type: "select", label: "How much should your AI team do without asking?",
    options: [
      { value: "approve_commitments", label: "Contact vendors freely; ask me before any booking, payment, contract or public post (recommended)" },
      { value: "approve_all", label: "Ask me before every single message goes out" },
      { value: "budget_guardrails", label: "Book small items within budget automatically; ask me for anything bigger" },
    ] },
];
