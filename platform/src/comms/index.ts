import crypto from "node:crypto";
import { config } from "../config.js";
import type { Channel, Communication, EventRecord, Vendor } from "../types.js";
import { nowIso, uid } from "../util.js";

/**
 * CommsHub: the agents' phone, inbox and SMS thread.
 *
 * Providers: Resend (email), Twilio (SMS + voice). Live sending requires
 * COMMS_LIVE=true *and* provider credentials; otherwise messages are recorded
 * with status "simulated". Every outbound voice call opens with an AI
 * disclosure, every first SMS carries opt-out language, and vendors that reply
 * STOP are marked do-not-contact.
 */

export interface OutboundMessage {
  event: EventRecord;
  roleId: string;
  channel: Exclude<Channel, "internal">;
  vendor?: Vendor;
  to: string;
  subject?: string;
  body: string;
}

export const AI_DISCLOSURE = "Hi, this is an AI assistant calling on behalf of Eventifyre for one of our event hosts.";
export const SMS_OPT_OUT = "Reply STOP to opt out.";

export function threadKey(eventId: string, vendorIdOrAddress: string) {
  return `${eventId}:${vendorIdOrAddress}`;
}

export function replyToAddress(eventId: string, vendorId?: string): string | undefined {
  if (!config.email.replyDomain) return undefined;
  return `evt-${eventId}${vendorId ? `+${vendorId}` : ""}@${config.email.replyDomain}`;
}

export function parseReplyAddress(address: string): { eventId: string; vendorId?: string } | null {
  const m = /evt-(evt_[a-z0-9]+)(?:\+(ven_[a-z0-9]+))?@/i.exec(address);
  return m ? { eventId: m[1], vendorId: m[2] } : null;
}

export function channelLive(channel: Channel): boolean {
  if (!config.commsLive) return false;
  if (channel === "email") return Boolean(config.email.resendApiKey);
  if (channel === "sms" || channel === "voice") return Boolean(config.twilio.accountSid && config.twilio.authToken && config.twilio.fromNumber);
  return false;
}

/** Sends (or simulates) a message and returns the Communication record to store. */
export async function send(msg: OutboundMessage): Promise<Communication> {
  const comm: Communication = {
    id: uid("msg"),
    eventId: msg.event.id,
    roleId: msg.roleId,
    vendorId: msg.vendor?.id,
    channel: msg.channel,
    direction: "outbound",
    to: msg.to,
    from: msg.channel === "email" ? config.email.from : config.twilio.fromNumber,
    subject: msg.subject,
    body: msg.body,
    status: "simulated",
    threadKey: threadKey(msg.event.id, msg.vendor?.id ?? msg.to),
    createdAt: nowIso(),
  };

  if (msg.channel === "sms" && !alreadyTexted(msg.event, comm.threadKey)) {
    comm.body = `${comm.body}\n${SMS_OPT_OUT}`;
  }
  if (msg.channel === "voice" && !comm.body.startsWith(AI_DISCLOSURE)) {
    comm.body = `${AI_DISCLOSURE} ${comm.body}`;
  }

  if (!channelLive(msg.channel)) {
    comm.provider = "simulator";
    return comm;
  }

  try {
    if (msg.channel === "email") {
      const id = await sendEmail(msg.to, msg.subject ?? "Event inquiry", comm.body, replyToAddress(msg.event.id, msg.vendor?.id));
      Object.assign(comm, { provider: "resend", providerId: id, status: "sent" });
    } else if (msg.channel === "sms") {
      const id = await sendSms(msg.to, comm.body);
      Object.assign(comm, { provider: "twilio", providerId: id, status: "sent" });
    } else {
      const id = await placeCall(msg.to, comm.body, msg.event.id, comm.threadKey);
      Object.assign(comm, { provider: "twilio", providerId: id, status: "sent" });
    }
  } catch (err) {
    comm.status = "failed";
    comm.body += `\n\n[send failed: ${(err as Error).message}]`;
  }
  return comm;
}

function alreadyTexted(event: EventRecord, key: string) {
  return event.communications.some((c) => c.threadKey === key && c.channel === "sms" && c.direction === "outbound");
}

async function sendEmail(to: string, subject: string, text: string, replyTo?: string): Promise<string> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.email.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.email.from, to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

function twilioAuth() {
  return "Basic " + Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString("base64");
}

async function twilioPost(resource: string, params: Record<string, string>): Promise<string> {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/${resource}.json`, {
    method: "POST",
    headers: { Authorization: twilioAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new Error(`Twilio HTTP ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { sid: string }).sid;
}

async function sendSms(to: string, body: string): Promise<string> {
  return twilioPost("Messages", {
    To: to, From: config.twilio.fromNumber!, Body: body,
    StatusCallback: `${config.publicBaseUrl}/webhooks/twilio/status`,
  });
}

async function placeCall(to: string, script: string, eventId: string, thread: string): Promise<string> {
  return twilioPost("Calls", {
    To: to, From: config.twilio.fromNumber!,
    Twiml: voiceTwiml(script, eventId, thread, 0),
    StatusCallback: `${config.publicBaseUrl}/webhooks/twilio/status`,
  });
}

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

/** TwiML: speak, then listen for the vendor's answer and post it back to us. */
export function voiceTwiml(say: string, eventId: string, thread: string, turn: number, hangup = false): string {
  if (hangup) return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${xml(say)}</Say><Hangup/></Response>`;
  const action = `${config.publicBaseUrl}/webhooks/twilio/voice?event=${encodeURIComponent(eventId)}&thread=${encodeURIComponent(thread)}&turn=${turn + 1}`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${xml(say)}</Say>` +
    `<Gather input="speech" speechTimeout="auto" action="${xml(action)}" method="POST"/>` +
    `<Say voice="Polly.Joanna">Sorry, I didn't catch that. We'll follow up by email. Thank you!</Say></Response>`;
}

/** Validate X-Twilio-Signature (HMAC-SHA1 over URL + sorted POST params). */
export function validTwilioSignature(url: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!config.twilio.authToken) return !config.commsLive; // allow local testing when not live
  if (!signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = crypto.createHmac("sha1", config.twilio.authToken).update(data).digest("base64");
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function isOptOut(body: string): boolean {
  return /^\s*(stop|unsubscribe|cancel|end|quit|stopall)\s*$/i.test(body);
}
