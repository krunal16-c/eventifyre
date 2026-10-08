/**
 * Event type profiles. The Event Director classifies every brief into one of
 * these (or "custom"); the profile gives sensible defaults the planner uses
 * when the host has not said otherwise.
 */
export interface EventTypeProfile {
  id: string;
  label: string;
  keywords: string[];
  defaultGuests: number;
  defaultDurationHours: number;
  /** Typical lead time in days for a comfortable plan. */
  idealLeadDays: number;
  typicallyTicketed: boolean;
  budgetAllocation: { category: string; percent: number }[];
}

const alloc = (pairs: [string, number][]) => pairs.map(([category, percent]) => ({ category, percent }));

export const EVENT_TYPES: EventTypeProfile[] = [
  {
    id: "wedding", label: "Wedding", keywords: ["wedding", "bride", "groom", "marry", "marriage", "nuptial", "vows", "elope"],
    defaultGuests: 120, defaultDurationHours: 8, idealLeadDays: 300, typicallyTicketed: false,
    budgetAllocation: alloc([["Venue", 30], ["Catering & Bar", 28], ["Photo & Video", 10], ["Decor & Florals", 10], ["Entertainment", 7], ["Attire & Beauty", 5], ["Stationery & Favors", 3], ["Transport & Lodging", 3], ["Contingency", 4]]),
  },
  {
    id: "conference", label: "Conference / Summit", keywords: ["conference", "summit", "symposium", "convention", "keynote", "speakers", "panel", "tech talk"],
    defaultGuests: 300, defaultDurationHours: 9, idealLeadDays: 240, typicallyTicketed: true,
    budgetAllocation: alloc([["Venue", 30], ["Catering", 20], ["AV & Production", 18], ["Speakers & Program", 8], ["Marketing", 10], ["Badges, Print & Swag", 5], ["Staffing & Security", 4], ["Contingency", 5]]),
  },
  {
    id: "corporate_offsite", label: "Corporate Offsite / Retreat", keywords: ["offsite", "retreat", "team building", "kickoff", "all-hands", "company", "corporate", "strategy session"],
    defaultGuests: 50, defaultDurationHours: 16, idealLeadDays: 90, typicallyTicketed: false,
    budgetAllocation: alloc([["Venue & Lodging", 40], ["Catering", 22], ["Activities", 12], ["Travel & Transport", 12], ["AV", 5], ["Swag", 4], ["Contingency", 5]]),
  },
  {
    id: "birthday", label: "Birthday Party", keywords: ["birthday", "bday", "turning", "th party", "sweet 16", "quinceañera", "quinceanera"],
    defaultGuests: 40, defaultDurationHours: 4, idealLeadDays: 45, typicallyTicketed: false,
    budgetAllocation: alloc([["Venue", 25], ["Catering & Cake", 30], ["Decor", 15], ["Entertainment", 15], ["Favors & Invites", 5], ["Photo", 5], ["Contingency", 5]]),
  },
  {
    id: "concert", label: "Concert / Live Show", keywords: ["concert", "gig", "live music", "show", "tour", "performance", "headliner"],
    defaultGuests: 500, defaultDurationHours: 5, idealLeadDays: 120, typicallyTicketed: true,
    budgetAllocation: alloc([["Talent", 35], ["Venue", 20], ["Production (sound/light/stage)", 20], ["Marketing", 10], ["Security & Staff", 8], ["Ticketing fees", 2], ["Contingency", 5]]),
  },
  {
    id: "festival", label: "Festival / Fair", keywords: ["festival", "fest", "fair", "carnival", "market", "block party", "street"],
    defaultGuests: 2000, defaultDurationHours: 10, idealLeadDays: 270, typicallyTicketed: true,
    budgetAllocation: alloc([["Site & Permits", 18], ["Talent", 20], ["Production", 18], ["Infrastructure (power, toilets, fencing)", 14], ["Security & Medical", 10], ["Marketing", 10], ["Staff & Volunteers", 5], ["Contingency", 5]]),
  },
  {
    id: "gala_fundraiser", label: "Gala / Fundraiser", keywords: ["gala", "fundraiser", "charity", "benefit", "auction", "donor", "nonprofit", "ball"],
    defaultGuests: 250, defaultDurationHours: 5, idealLeadDays: 180, typicallyTicketed: true,
    budgetAllocation: alloc([["Venue", 25], ["Catering & Bar", 30], ["Decor & Production", 15], ["Entertainment & Program", 10], ["Marketing & Invitations", 8], ["Auction & Fundraising", 5], ["Photo", 3], ["Contingency", 4]]),
  },
  {
    id: "product_launch", label: "Product Launch / Brand Activation", keywords: ["launch", "activation", "pop-up", "popup", "unveil", "brand experience", "press event", "release party"],
    defaultGuests: 150, defaultDurationHours: 4, idealLeadDays: 90, typicallyTicketed: false,
    budgetAllocation: alloc([["Venue", 22], ["Experience Design & Fabrication", 22], ["AV & Production", 15], ["PR & Influencers", 15], ["Catering & Bar", 14], ["Content Capture", 7], ["Contingency", 5]]),
  },
  {
    id: "trade_show", label: "Trade Show / Expo", keywords: ["trade show", "expo", "exhibition", "booth", "exhibitor"],
    defaultGuests: 1000, defaultDurationHours: 9, idealLeadDays: 270, typicallyTicketed: true,
    budgetAllocation: alloc([["Venue & Floor", 35], ["Booth Build & Rentals", 15], ["Marketing & Exhibitor Sales", 15], ["AV", 10], ["Catering", 10], ["Security & Staff", 10], ["Contingency", 5]]),
  },
  {
    id: "workshop", label: "Workshop / Class / Meetup", keywords: ["workshop", "class", "meetup", "bootcamp", "training", "seminar", "masterclass", "webinar"],
    defaultGuests: 30, defaultDurationHours: 3, idealLeadDays: 30, typicallyTicketed: true,
    budgetAllocation: alloc([["Venue", 35], ["Instructor/Speaker", 25], ["Materials", 10], ["Catering", 15], ["Marketing", 10], ["Contingency", 5]]),
  },
  {
    id: "networking", label: "Networking / Mixer", keywords: ["networking", "mixer", "happy hour", "social", "meet and greet", "cocktail party"],
    defaultGuests: 80, defaultDurationHours: 3, idealLeadDays: 30, typicallyTicketed: true,
    budgetAllocation: alloc([["Venue", 30], ["Food & Bar", 40], ["Marketing", 10], ["Decor & Signage", 8], ["Photo", 5], ["Contingency", 7]]),
  },
  {
    id: "private_party", label: "Private Party / Celebration", keywords: ["party", "celebration", "anniversary", "engagement", "retirement", "farewell", "housewarming", "dinner party", "holiday party", "bachelor", "bachelorette"],
    defaultGuests: 60, defaultDurationHours: 5, idealLeadDays: 60, typicallyTicketed: false,
    budgetAllocation: alloc([["Venue", 25], ["Catering & Bar", 35], ["Decor", 12], ["Entertainment", 13], ["Photo", 5], ["Invites & Favors", 4], ["Contingency", 6]]),
  },
  {
    id: "sports", label: "Sports / Tournament / Race", keywords: ["tournament", "race", "marathon", "5k", "10k", "match", "league", "game day", "cup", "championship", "golf"],
    defaultGuests: 400, defaultDurationHours: 8, idealLeadDays: 150, typicallyTicketed: true,
    budgetAllocation: alloc([["Venue/Course & Permits", 25], ["Equipment & Timing", 15], ["Medical & Security", 15], ["Prizes & Merch", 12], ["Marketing", 10], ["Catering & Hydration", 10], ["Staff & Volunteers", 8], ["Contingency", 5]]),
  },
  {
    id: "religious_cultural", label: "Religious / Cultural Ceremony", keywords: ["bar mitzvah", "bat mitzvah", "baptism", "christening", "communion", "diwali", "eid", "mehndi", "sangeet", "puja", "lunar new year", "ceremony", "naming"],
    defaultGuests: 150, defaultDurationHours: 6, idealLeadDays: 150, typicallyTicketed: false,
    budgetAllocation: alloc([["Venue", 25], ["Catering", 30], ["Decor", 15], ["Officiant & Ritual items", 8], ["Entertainment", 10], ["Photo & Video", 7], ["Contingency", 5]]),
  },
  {
    id: "memorial", label: "Memorial / Celebration of Life", keywords: ["memorial", "funeral", "celebration of life", "wake", "remembrance", "tribute"],
    defaultGuests: 100, defaultDurationHours: 3, idealLeadDays: 10, typicallyTicketed: false,
    budgetAllocation: alloc([["Venue", 30], ["Catering", 30], ["Florals", 15], ["Printing & Tributes", 8], ["AV & Livestream", 7], ["Contingency", 10]]),
  },
  {
    id: "baby_shower", label: "Baby / Bridal Shower", keywords: ["baby shower", "bridal shower", "gender reveal", "sip and see"],
    defaultGuests: 30, defaultDurationHours: 3, idealLeadDays: 45, typicallyTicketed: false,
    budgetAllocation: alloc([["Venue", 20], ["Food & Cake", 35], ["Decor", 20], ["Games & Favors", 10], ["Invites", 5], ["Contingency", 10]]),
  },
  {
    id: "graduation", label: "Graduation / Reunion", keywords: ["graduation", "grad party", "reunion", "alumni", "homecoming", "prom"],
    defaultGuests: 100, defaultDurationHours: 5, idealLeadDays: 90, typicallyTicketed: false,
    budgetAllocation: alloc([["Venue", 28], ["Catering & Bar", 32], ["Entertainment", 12], ["Decor", 10], ["Photo", 6], ["Invites & Outreach", 5], ["Contingency", 7]]),
  },
  {
    id: "hackathon", label: "Hackathon / Competition", keywords: ["hackathon", "hack day", "game jam", "competition", "pitch", "demo day", "startup"],
    defaultGuests: 150, defaultDurationHours: 30, idealLeadDays: 90, typicallyTicketed: false,
    budgetAllocation: alloc([["Venue", 25], ["Food (all meals)", 30], ["Prizes", 15], ["Wi-Fi & Tech", 10], ["Swag", 8], ["Marketing", 7], ["Contingency", 5]]),
  },
  {
    id: "community", label: "Community / Civic Event", keywords: ["community", "town hall", "neighborhood", "rally", "cleanup", "drive", "open house", "volunteer day"],
    defaultGuests: 200, defaultDurationHours: 4, idealLeadDays: 60, typicallyTicketed: false,
    budgetAllocation: alloc([["Site & Permits", 25], ["Food", 20], ["AV", 15], ["Outreach", 15], ["Rentals", 10], ["Safety", 8], ["Contingency", 7]]),
  },
];

export const CUSTOM_EVENT: EventTypeProfile = {
  id: "custom", label: "Custom Event", keywords: [],
  defaultGuests: 80, defaultDurationHours: 5, idealLeadDays: 90, typicallyTicketed: false,
  budgetAllocation: alloc([["Venue", 28], ["Catering", 30], ["Decor", 10], ["Entertainment", 10], ["Marketing & Invites", 7], ["Photo", 5], ["Contingency", 10]]),
};

export function getEventType(id: string | undefined): EventTypeProfile {
  return EVENT_TYPES.find((t) => t.id === id) ?? CUSTOM_EVENT;
}

/** Keyword classifier used when no LLM is configured (and as a hint for the LLM). */
export function classifyEventType(text: string): EventTypeProfile {
  const lower = text.toLowerCase();
  let best: { profile: EventTypeProfile; score: number } = { profile: CUSTOM_EVENT, score: 0 };
  for (const profile of EVENT_TYPES) {
    const score = profile.keywords.reduce((s, k) => s + (lower.includes(k) ? k.length : 0), 0);
    if (score > best.score) best = { profile, score };
  }
  return best.profile;
}
