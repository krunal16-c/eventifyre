import { config } from "../config.js";
import type { Vendor } from "../types.js";
import { uid } from "../util.js";

/**
 * Vendor discovery.
 *
 * With GOOGLE_PLACES_API_KEY set, agents search real local businesses through
 * the Places API (Text Search). Places returns phone numbers and websites but
 * not email addresses, so for those vendors agents call/text first or ask for
 * an email. Without a key, a deterministic simulated directory is used: names
 * are fictional, emails use the reserved example.com domain and phones use the
 * 555-01xx fictional range, so nothing can reach a real person by accident.
 */
export interface VendorSearch {
  category: string;
  city: string;
  query?: string;     // style hints: "rooftop", "vegan", "jazz trio"
  limit?: number;
}

export async function searchVendors(search: VendorSearch): Promise<Vendor[]> {
  const limit = Math.min(search.limit ?? 5, 10);
  if (config.googlePlacesApiKey) {
    try {
      return await searchGooglePlaces(search, limit);
    } catch (err) {
      console.warn(`[vendors] Places search failed, using simulated directory: ${(err as Error).message}`);
    }
  }
  return simulatedVendors(search, limit);
}

async function searchGooglePlaces(search: VendorSearch, limit: number): Promise<Vendor[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": config.googlePlacesApiKey!,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.websiteUri,places.rating,places.priceLevel",
    },
    body: JSON.stringify({ textQuery: `${search.query ?? ""} ${search.category} in ${search.city}`.trim(), pageSize: limit }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { places?: any[] };
  const priceMap: Record<string, number> = { PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };
  return (data.places ?? []).slice(0, limit).map((p) => ({
    id: uid("ven"),
    name: p.displayName?.text ?? "Unknown",
    category: search.category,
    city: search.city,
    phone: p.internationalPhoneNumber,
    website: p.websiteUri,
    rating: p.rating,
    priceLevel: priceMap[p.priceLevel] ?? undefined,
    notes: p.formattedAddress,
    source: "google_places" as const,
  }));
}

const NAME_PARTS: Record<string, [string[], string[]]> = {
  venue: [["The Grand", "Skyline", "Harbor", "Old Mill", "Garden", "Loft", "Copper", "Lumen"], ["Hall", "Rooftop", "Estate", "Studio", "Pavilion", "Ballroom", "Warehouse", "Terrace"]],
  caterer: [["Fork &", "Saffron", "Golden Spoon", "Harvest", "Ember", "Olive"], ["Knife Catering", "Kitchen", "Table Co.", "Events Catering", "Feast Co."]],
  default: [["Bright", "Northstar", "Velvet", "Silverline", "Bluebird", "Evergreen", "Atlas", "Cedar"], ["Co.", "Collective", "Studio", "Group", "Services", "& Partners"]],
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

export function simulatedVendors(search: VendorSearch, limit: number): Vendor[] {
  const [first, second] = NAME_PARTS[search.category] ?? NAME_PARTS.default;
  const label = search.category.replace(/\b\w+/g, (w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));
  const out: Vendor[] = [];
  for (let i = 0; i < limit; i++) {
    const h = hash(`${search.city}|${search.category}|${search.query ?? ""}|${i}`);
    const base = `${first[h % first.length]} ${second[(h >> 4) % second.length]}`;
    const name = NAME_PARTS[search.category] ? base : `${base} ${label}`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    out.push({
      id: uid("ven"),
      name,
      category: search.category,
      city: search.city,
      email: `bookings@${slug}.example.com`,
      phone: `+1555010${(h % 90 + 10).toString().padStart(2, "0")}`.slice(0, 12),
      website: `https://${slug}.example.com`,
      rating: Math.round((3.8 + (h % 12) / 10) * 10) / 10,
      priceLevel: (h % 4) + 1,
      notes: "Simulated vendor (no Places API key configured).",
      source: "simulated",
    });
  }
  return out;
}
