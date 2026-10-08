import type { EventRecord, Vendor } from "../types.js";

/**
 * When comms are simulated, vendors still need to "answer" so the agents can
 * be exercised end to end. Replies are deterministic per vendor, priced from
 * the event's own budget allocation, and clearly labeled as simulated.
 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

export function estimateCategorySpend(event: EventRecord, category: string): number {
  const bp = event.blueprint;
  if (!bp) return 1000;
  const c = category.toLowerCase();
  const words = c.split(/\s+/);
  const line = bp.budgetAllocation.find((a) => {
    const name = a.category.toLowerCase();
    return name.includes(c) || words.some((w) => w.length > 3 && name.includes(w.slice(0, 5)));
  });
  return Math.round((bp.budget * (line?.percent ?? 6)) / 100);
}

export interface SimulatedReply {
  available: boolean;
  amount?: number;
  body: string;
}

export function simulateVendorReply(event: EventRecord, vendor: Vendor): SimulatedReply {
  const h = hash(vendor.id + vendor.name);
  const date = event.blueprint?.date ?? "your date";
  if (event.quotes.some((q) => q.vendorId === vendor.id)) {
    return { available: true, body: `[SIMULATED REPLY] Thanks for the update! ${vendor.name} will send the contract and deposit invoice shortly. Looking forward to ${date}.` };
  }
  if (h % 5 === 0) {
    return { available: false, body: `[SIMULATED REPLY] Thanks for reaching out! Unfortunately ${vendor.name} is already booked on ${date}. Best of luck with the event.` };
  }
  const base = estimateCategorySpend(event, vendor.category);
  const factor = 0.7 + ((vendor.priceLevel ?? 2) - 1) * 0.15 + ((h >> 3) % 20) / 100;
  const amount = Math.round((base * factor) / 50) * 50;
  const currency = event.blueprint?.currency ?? "USD";
  return {
    available: true,
    amount,
    body: `[SIMULATED REPLY] Hi! ${vendor.name} is available on ${date}. For ${event.blueprint?.guestCount ?? "your"} guests our package would be ${currency} ${amount.toLocaleString("en-US")}, ` +
      `which includes setup and breakdown. We require a 30% deposit to hold the date and the quote is valid for 14 days. Happy to jump on a call.`,
  };
}
