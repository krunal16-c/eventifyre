import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { config, llmEnabled } from "./config.js";
import { store } from "./store.js";
import { QUESTIONNAIRE } from "./catalog/questionnaire.js";
import { ROLES } from "./catalog/roles.js";
import { EVENT_TYPES } from "./catalog/eventTypes.js";
import * as orchestrator from "./orchestrator.js";
import * as comms from "./comms/index.js";
import { nextVoiceLine } from "./comms/voiceAgent.js";
import { uid, nowIso } from "./util.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const optionalNumber = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().positive().optional());
const optionalText = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().max(4000).optional());

const BriefSchema = z.object({
  hostName: z.string().min(1).max(200),
  hostEmail: z.email(),
  hostPhone: optionalText,
  organization: optionalText,
  vision: z.string().min(10).max(8000),
  eventType: optionalText,
  date: z.preprocess((v) => (v === "" ? undefined : v), z.iso.date().optional()),
  dateFlexible: z.coerce.boolean().optional(),
  city: z.string().min(1).max(200),
  guestCount: optionalNumber,
  budget: optionalNumber,
  currency: optionalText,
  venuePreference: optionalText,
  mustHaves: optionalText,
  dealBreakers: optionalText,
  audience: optionalText,
  ticketed: z.coerce.boolean().optional(),
  accessibilityNeeds: optionalText,
  dietaryNeeds: optionalText,
  brandAssets: optionalText,
  autonomy: z.enum(["approve_all", "approve_commitments", "budget_guardrails"]).optional(),
});

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  // ─── Platform API ───
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      agents: llmEnabled() ? `live (${config.model})` : "offline simulator",
      comms: { live: config.commsLive, email: comms.channelLive("email"), sms: comms.channelLive("sms"), voice: comms.channelLive("voice") },
      vendorSearch: config.googlePlacesApiKey ? "google_places" : "simulated",
    });
  });
  app.get("/api/questionnaire", (_req, res) => { res.json(QUESTIONNAIRE); });
  app.get("/api/catalog", (_req, res) => { res.json({ roles: ROLES, eventTypes: EVENT_TYPES }); });

  app.post("/api/events", async (req, res) => {
    const parsed = BriefSchema.safeParse(req.body?.brief ?? req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid questionnaire", issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
      return;
    }
    const rec = await orchestrator.createEvent(parsed.data, { fastForward: req.body?.fastForward === true });
    res.status(201).json({ id: rec.id });
  });

  app.get("/api/events", (_req, res) => {
    res.json(store.list().map((r) => ({ id: r.id, title: r.blueprint?.title ?? r.brief.vision.slice(0, 60), eventType: r.blueprint?.eventType ?? null, status: r.status, date: r.blueprint?.date ?? r.brief.date ?? null, city: r.brief.city, createdAt: r.createdAt, pendingApprovals: r.approvals.filter((a) => a.status === "pending").length })));
  });

  app.get("/api/events/:id", (req, res) => {
    const rec = store.get(req.params.id);
    if (!rec) { res.status(404).json({ error: "Not found" }); return; }
    res.json(rec);
  });

  // Server-sent events: the dashboard re-fetches whenever the event changes.
  app.get("/api/events/:id/stream", (req, res) => {
    const id = req.params.id;
    if (!store.get(id)) { res.status(404).end(); return; }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ updatedAt: store.get(id)!.updatedAt })}\n\n`);
    let timer: NodeJS.Timeout | null = null;
    const onChange = (changed: string) => {
      if (changed !== id || timer) return;
      timer = setTimeout(() => { timer = null; res.write(`data: ${JSON.stringify({ updatedAt: store.get(id)?.updatedAt })}\n\n`); }, 250);
    };
    store.on("change", onChange);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => { store.off("change", onChange); clearInterval(ping); if (timer) clearTimeout(timer); });
  });

  app.post("/api/events/:id/approvals/:approvalId", async (req, res) => {
    const body = z.object({ approve: z.boolean(), note: z.string().max(2000).optional() }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "approve (boolean) required" }); return; }
    try {
      await orchestrator.decideApproval(req.params.id, req.params.approvalId, body.data.approve, body.data.note);
      res.json({ ok: true });
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
    }
  });

  app.post("/api/events/:id/pause", async (req, res) => { await orchestrator.setPaused(req.params.id, true); res.json({ ok: true }); });
  app.post("/api/events/:id/resume", async (req, res) => { await orchestrator.setPaused(req.params.id, false); res.json({ ok: true }); });
  app.post("/api/events/:id/tasks/:taskId/retry", async (req, res) => { await orchestrator.retryTask(req.params.id, req.params.taskId); res.json({ ok: true }); });

  app.post("/api/events/:id/vendors", async (req, res) => {
    const body = z.object({ name: z.string().min(1), category: z.string().min(1), email: z.email().optional(), phone: z.string().optional(), website: z.string().optional(), notes: z.string().optional() }).safeParse(req.body);
    if (!body.success || !store.get(req.params.id)) { res.status(400).json({ error: "Invalid vendor" }); return; }
    const vendor = { id: uid("ven"), city: store.get(req.params.id)!.brief.city, source: "host_provided" as const, ...body.data };
    await store.mutate(req.params.id, (r) => { r.vendors.push(vendor); });
    res.status(201).json(vendor);
  });

  // ─── Provider webhooks ───
  const twilioOk = (req: express.Request) =>
    comms.validTwilioSignature(`${config.publicBaseUrl}${req.originalUrl}`, req.body ?? {}, req.header("X-Twilio-Signature"));

  app.post("/webhooks/twilio/sms", async (req, res) => {
    if (!twilioOk(req)) { res.status(403).end(); return; }
    await orchestrator.handleInbound({ channel: "sms", from: req.body.From, to: req.body.To, body: req.body.Body ?? "", provider: "twilio", providerId: req.body.MessageSid });
    res.type("text/xml").send("<Response/>");
  });

  app.post("/webhooks/twilio/voice", async (req, res) => {
    if (!twilioOk(req)) { res.status(403).end(); return; }
    const eventId = String(req.query.event ?? "");
    const thread = String(req.query.thread ?? "");
    const turn = Number(req.query.turn ?? 1);
    const speech: string = req.body.SpeechResult ?? "";
    if (speech) {
      await orchestrator.handleInbound({ channel: "voice", from: req.body.To, body: speech, eventId, provider: "twilio", providerId: req.body.CallSid });
    }
    const { say, hangup } = await nextVoiceLine(eventId, thread, turn);
    await store.mutate(eventId, (r) => {
      r.communications.push({ id: uid("msg"), eventId, roleId: r.communications.find((c) => c.threadKey === thread)?.roleId ?? "event_director", channel: "voice", direction: "outbound", body: say, status: "sent", provider: "twilio", threadKey: thread, createdAt: nowIso() });
    }).catch(() => undefined);
    res.type("text/xml").send(comms.voiceTwiml(say, eventId, thread, turn, hangup));
  });

  app.post("/webhooks/twilio/status", async (req, res) => {
    if (!twilioOk(req)) { res.status(403).end(); return; }
    const sid = req.body.MessageSid ?? req.body.CallSid;
    const status = req.body.MessageStatus ?? req.body.CallStatus;
    for (const rec of store.list()) {
      const c = rec.communications.find((x) => x.providerId === sid);
      if (c) {
        await store.mutate(rec.id, (r) => {
          const m = r.communications.find((x) => x.id === c.id)!;
          if (status === "delivered" || status === "completed") m.status = "delivered";
          if (status === "failed" || status === "undelivered" || status === "no-answer" || status === "busy") m.status = "failed";
        });
        break;
      }
    }
    res.status(204).end();
  });

  /**
   * Generic inbound email webhook (works with Resend inbound, SendGrid Inbound
   * Parse, Mailgun routes, Postmark via a small mapping). Expects JSON
   * { from, to, subject, text } and the shared secret in X-Webhook-Secret.
   */
  app.post("/webhooks/email/inbound", async (req, res) => {
    if (!config.webhookSecret || req.header("X-Webhook-Secret") !== config.webhookSecret) { res.status(403).end(); return; }
    const { from, to, subject, text } = req.body ?? {};
    if (!from || !text) { res.status(400).end(); return; }
    const addr = comms.parseReplyAddress(String(to ?? ""));
    const fromAddr = /<([^>]+)>/.exec(String(from))?.[1] ?? String(from);
    const comm = await orchestrator.handleInbound({ channel: "email", from: fromAddr, to, subject, body: String(text), eventId: addr?.eventId, vendorId: addr?.vendorId, provider: "email" });
    res.status(comm ? 200 : 202).json({ routed: Boolean(comm) });
  });

  /** Dev helper: pretend a vendor replied (only while comms are simulated). */
  app.post("/api/events/:id/simulate-reply", async (req, res) => {
    if (config.commsLive) { res.status(403).json({ error: "Disabled when COMMS_LIVE=true" }); return; }
    const body = z.object({ vendorId: z.string(), channel: z.enum(["email", "sms", "voice"]).default("email"), body: z.string().min(1) }).safeParse(req.body);
    const vendor = body.success ? store.get(req.params.id)?.vendors.find((v) => v.id === body.data.vendorId) : undefined;
    if (!body.success || !vendor) { res.status(400).json({ error: "Unknown vendor" }); return; }
    const comm = await orchestrator.handleInbound({ channel: body.data.channel, from: vendor.email ?? vendor.phone ?? vendor.name, body: body.data.body, eventId: req.params.id, vendorId: vendor.id, provider: "simulator" });
    res.json({ routed: Boolean(comm) });
  });

  app.use(express.static(path.join(here, "..", "public")));
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const app = createApp();
  orchestrator.startScheduler();
  app.listen(config.port, () => {
    console.log(`Eventifyre platform on ${config.publicBaseUrl}`);
    console.log(`  agents: ${llmEnabled() ? `Claude (${config.model})` : "offline simulator (set ANTHROPIC_API_KEY for live agents)"}`);
    console.log(`  comms:  ${config.commsLive ? "LIVE" : "simulated (set COMMS_LIVE=true + provider keys to send for real)"}`);
  });
}
