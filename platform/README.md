# Eventifyre Platform — AI-native event management

A host fills in one questionnaire and describes their vision in plain language. Eventifyre then staffs a full
event production team made of AI agents — one for every role a professional event company would hire — and those
agents do the work: find venues and vendors, email, text and call them, collect and compare quotes, negotiate,
draft invitations and marketing, handle permits and insurance, build the run-of-show, reconfirm vendors, run the day,
pay vendors and send thank-you notes.

The host stays in control: **nothing is booked, paid, signed or published without their approval.**

```
 Questionnaire + vision ──► Event Director ──► Blueprint ──► Planner ──► AI team (33 roles)
                                                                          │   + task graph with deadlines
                                                                          ▼
   Host approvals ◄── Orchestrator: dispatch ready tasks ──► Specialist agents (Claude tool-use loops)
        │                 ▲          (deps + calendar)               │
        └── approve ──────┘                                          ├─ search_vendors (Google Places)
                          ▲                                          ├─ send_email (Resend) / send_sms / place_call (Twilio)
     vendor replies ──────┘  (webhooks: SMS, email, voice)           ├─ record_quote, update_budget, request_approval
                                                                     ├─ create_marketing_asset, add_timeline_item
                                                                     └─ log_risk, add_task (hand-offs), message_host
```

## Quick start

```bash
cd platform
npm install
npm start            # http://localhost:3000
npm run demo         # CLI: plan + run a whole event, auto-approving as the host
npm test             # planner, approvals, guardrails, opt-out, full lifecycle
npm run typecheck
```

With no keys configured it runs fully offline: a scripted **simulator** drives the same tools the AI agents use,
vendors come from a simulated directory (`*.example.com` emails, fictional 555 numbers) and vendor replies are
simulated, so you can watch an event go from vision to wrap-up in seconds. Tick *Demo mode* in the form to skip the
calendar (otherwise day-of tasks wait for the event date and wrap-up for the day after).

Add `ANTHROPIC_API_KEY` to switch on the real agents. Copy `.env.example` to `.env` for the full list of settings.

## How it works

1. **Intake** (`src/catalog/questionnaire.ts`) — only vision, city and contact are required. The host also picks an
   autonomy level:
   - `approve_commitments` (default): agents contact vendors freely; bookings, payments, contracts and public posts need approval.
   - `approve_all`: every outbound message is queued for the host first.
   - `budget_guardrails`: bookings under 10% of the total budget are auto-approved; bigger ones still go to the host.
2. **Event Director** (`src/agents/director.ts`) — turns the brief into a structured `Blueprint` (theme, goals,
   guest journey, constraints, budget allocation, open questions) using structured outputs. Questionnaire answers
   always win over model inference.
3. **Planner** (`src/agents/planner.ts`) — staffs roles from the catalog: core roles for every event, core roles for
   the event type, and roles triggered by what the host wrote ("live band" → Entertainment Booker + Production
   Manager; "kids" → Kids & Family Coordinator; "eco" → Sustainability). Each role brings tasks with lead times and
   cross-role dependencies; deadlines are worked backwards from the event date and compressed for short lead times.
4. **Orchestrator** (`src/orchestrator.ts`) — repeatedly dispatches every task whose dependencies are done and whose
   time has come, up to `EVENTIFYRE_AGENT_CONCURRENCY` agents at once. Tasks end as `done`, `waiting_approval`,
   `waiting_vendor` or `blocked` (one automatic retry). Approvals and inbound vendor replies wake the right agent.
   A 10-minute scheduler picks up date-gated work (T-3 reconfirmations, event day, wrap-up).
5. **Specialist agents** (`src/agents/specialist.ts`) — a Claude tool-use loop per task with a role-specific system
   prompt (stable, so it is prompt-cached) and the shared toolset in `src/agents/tools.ts`. Every tool input is
   validated with zod before it runs.

## The AI team ("map each person involved")

`src/catalog/roles.ts` is the backbone that makes sure nothing is missed — including the unglamorous work
(permits, liability insurance, accessibility, weather plans, load-out, vendor payments, thank-yous). Each role
lists its responsibilities, channels, vendor categories and tasks.

**Leadership**

| Agent (replaces) | What it does | Staffed when |
|---|---|---|
| Event Director (Executive Producer) | Own the host's vision end to end, coordinate every agent, make trade-offs, and keep the host informed. | Every event |
| Creative Director (Concept & Design) | Translate the vision into a cohesive look, feel and guest journey every vendor can execute. | Every event |
| Budget & Finance Manager | Protect the budget: allocate it, track every quote and commitment, schedule deposits and payments, and reconcile. | Every event |
| Permits, Contracts & Insurance Officer | Make the event legal and insured: permits, licenses, contracts, liability coverage, and policy compliance. | Every event |

**Venue & Production**

| Agent (replaces) | What it does | Staffed when |
|---|---|---|
| Venue Scout & Booking Manager | Find, tour (virtually), negotiate and book the venue that fits the vision, headcount, budget and date. | Every event |
| Production Manager (AV, Lighting & Staging) | Make the event look and sound right: sound, lighting, stage, screens, power and technical crew. | Core: conference, concert, festival, gala fundraiser, product launch, trade show, sports, wedding, workshop, hackathon; Brief mentions e.g. “stage”, “sound”, “speaker”, “speakers” |
| Rentals & Infrastructure Manager | Source everything physical the venue doesn't provide: furniture, tents, linens, tableware, restrooms, generators. | Core: wedding, festival, gala fundraiser, community, sports; Brief mentions e.g. “tent”, “outdoor”, “backyard”, “garden” |
| Decor & Styling Designer | Bring the creative concept to life in the space: decor, props, signage styling, table design, photo moments. | Core: wedding, birthday, private party, baby shower, graduation, religious cultural, gala fundraiser, product launch, networking; Brief mentions e.g. “decor”, “decoration”, “theme”, “themed” |
| Florist Coordinator | Source florals that match the palette, season and budget. | Core: wedding, memorial, gala fundraiser; Brief mentions e.g. “flower”, “flowers”, “floral”, “bouquet” |

**Food & Beverage**

| Agent (replaces) | What it does | Staffed when |
|---|---|---|
| Catering Manager | Feed every guest well, safely and on budget, respecting every dietary need. | Every event |
| Bar & Beverage Manager | Design and source the drinks program, including licensed bartending and non-alcoholic options. | Core: wedding, gala fundraiser, networking, private party; Brief mentions e.g. “bar”, “cocktail”, “cocktails”, “wine” |
| Cake & Dessert Coordinator | Source the cake or dessert experience that becomes a highlight. | Core: wedding, birthday, baby shower; Brief mentions e.g. “cake”, “dessert”, “cupcake”, “pastry” |

**Guest Experience**

| Agent (replaces) | What it does | Staffed when |
|---|---|---|
| Guest List, Invitations & RSVP Manager | Get the right people invited, informed and confirmed — and make every guest feel personally looked after. | Every event |
| Entertainment & Talent Booker | Book the people who create energy: DJs, bands, MCs, performers, activities. | Core: wedding, birthday, concert, festival, gala fundraiser, private party, graduation; Brief mentions e.g. “dj”, “band”, “music”, “jazz” |
| Program, Agenda & Speaker Manager | Build the content program: agenda, speakers, panels, ceremonies, toasts and presentations. | Core: conference, workshop, hackathon, product launch, trade show, gala fundraiser, corporate offsite, memorial; Brief mentions e.g. “speaker”, “speakers”, “keynote”, “panel” |
| Photography, Video & Livestream Producer | Capture the event so it lives on — and stream it if needed. | Core: wedding, gala fundraiser, conference, product launch, concert, religious cultural; Brief mentions e.g. “photo”, “photos”, “photographer”, “video” |
| Travel, Lodging & Transportation Coordinator | Get guests, speakers and VIPs there and home safely: hotel blocks, shuttles, parking, airport transfers. | Core: wedding, conference, corporate offsite, festival, trade show; Brief mentions e.g. “hotel”, “out of town”, “out-of-town”, “destination” |
| Accessibility & Inclusion Lead | Ensure every guest can attend fully: mobility, sensory, dietary, language, cultural and religious needs. | Every event |
| Staffing & Volunteer Manager | Put the right people on the floor: greeters, registration desk, runners, volunteers, coat check. | Core: festival, conference, concert, sports, trade show, community, hackathon; Brief mentions e.g. “volunteer”, “volunteers”, “staff”, “ushers” |
| Kids & Family Coordinator | Make the event work for children and families: activities, childcare, safety. | Brief mentions e.g. “kids”, “children”, “child”, “family” |
| Print, Signage, Swag & Favors Manager | Produce every printed and physical take-away: signage, badges, menus, programs, favors, merch. | Core: conference, trade show, wedding, product launch, hackathon; Brief mentions e.g. “favors”, “favours”, “swag”, “merch” |
| Ceremony & Traditions Coordinator | Plan ceremonies and cultural or religious traditions respectfully and accurately. | Core: wedding, religious cultural, memorial; Brief mentions e.g. “ceremony”, “officiant”, “vows”, “priest” |

**Operations**

| Agent (replaces) | What it does | Staffed when |
|---|---|---|
| Safety, Security & Medical Lead | Keep everyone safe: security, crowd management, first aid, emergency plans. | Core: concert, festival, sports, trade show, community; Brief mentions e.g. “security”, “vip”, “celebrity”, “crowd” |
| Logistics & Operations Manager | Make the physical plan work: load-in/out schedule, deliveries, power, waste, weather backup. | Every event |
| Event Tech & Hybrid Experience Manager | Run the digital layer: Wi-Fi, event app, virtual/hybrid platform, livestream, attendee tech. | Core: hackathon; Brief mentions e.g. “virtual”, “hybrid”, “online”, “zoom” |
| Sustainability Coordinator | Shrink the event's footprint: waste, food donation, reusables, transport. | Brief mentions e.g. “eco”, “sustainable”, “sustainability”, “zero waste” |
| Day-of Coordinator (Show Caller) | Run the day: the minute-by-minute run-of-show, every cue, every vendor, every surprise. | Every event |
| Post-Event & Insights Manager | Close the loop: thank-yous, feedback, deliverables, reviews, lessons learned. | Every event |

**Marketing & Growth**

| Agent (replaces) | What it does | Staffed when |
|---|---|---|
| Marketing Strategist | Fill the room with the right audience: positioning, channel plan, campaigns, and conversion tracking. | Core: conference, concert, festival, product launch, workshop, networking, gala fundraiser, community, trade show, hackathon, sports; Brief mentions e.g. “tickets”, “sell out”, “promote”, “marketing” |
| Social Media & Content Manager | Build buzz before, live-cover during, and recap after — on the channels the audience uses. | Core: conference, concert, festival, product launch, workshop, networking, gala fundraiser, community, trade show, hackathon, sports; Brief mentions e.g. “instagram”, “tiktok”, “social”, “viral” |
| PR & Media Relations Manager | Earn press coverage and manage media on the day. | Core: product launch, gala fundraiser, festival, concert; Brief mentions e.g. “press”, “media”, “pr”, “journalists” |
| Ticketing & Registration Manager | Make it effortless to buy, register and check in — and track every attendee. | Core: conference, concert, festival, workshop, hackathon, sports, networking, trade show; Brief mentions e.g. “tickets”, “ticket”, “ticketed”, “registration” |
| Sponsorship & Fundraising Manager | Bring in money beyond tickets: sponsors, partners, donors, auctions. | Core: conference, festival, gala fundraiser, hackathon, sports, trade show; Brief mentions e.g. “sponsor”, “sponsors”, “sponsorship”, “donor” |


Event types with tuned defaults (guest count, duration, lead time, budget split): wedding, conference, corporate
offsite, birthday, concert, festival, gala/fundraiser, product launch, trade show, workshop, networking, private
party, sports, religious/cultural ceremony, memorial, baby/bridal shower, graduation/reunion, hackathon, community —
and a `custom` profile for anything else (`src/catalog/eventTypes.ts`).

## Talking to vendors: email, SMS and calls

`src/comms/index.ts` — Resend for email, Twilio for SMS and voice.

- **Off by default.** Nothing reaches a real person unless `COMMS_LIVE=true` *and* provider keys are set; otherwise
  messages are stored with status `simulated`.
- **Honest by design.** Every call opens with an AI disclosure; the first SMS to a number carries "Reply STOP to opt
  out"; a STOP reply marks the vendor do-not-contact and agents can no longer message them. Agents are instructed to
  identify themselves as an AI assistant acting for the host and never to commit to a booking or payment in a message.
- **Voice calls** use Twilio `<Say>` + `<Gather input="speech">`; each vendor answer is posted to
  `/webhooks/twilio/voice`, logged as an inbound message for the calling agent, and a short Claude turn
  (`src/comms/voiceAgent.ts`) produces the next line until it has availability, price and a follow-up email.
- **Inbound routing.** SMS replies match the vendor's number; email replies go to
  `evt-<eventId>+<vendorId>@EMAIL_REPLY_DOMAIN` and are posted to `/webhooks/email/inbound` (JSON `{from,to,subject,text}`
  with `X-Webhook-Secret`). Twilio webhooks are signature-checked.
- **Spam guard.** Max 15 outbound messages per task run.

### Going live checklist

1. `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY` (real vendor discovery; Places returns phones/websites, not emails —
   agents call/text first or ask for an email).
2. Resend: verified sending domain → `RESEND_API_KEY`, `EMAIL_FROM`; inbound domain → `EMAIL_REPLY_DOMAIN` and point
   inbound mail at `/webhooks/email/inbound` with `WEBHOOK_SECRET`.
3. Twilio: number with SMS + voice → `TWILIO_*`; set the number's messaging webhook to `/webhooks/twilio/sms`.
   Register A2P 10DLC (US) before texting businesses, and check local rules for automated calls.
4. `PUBLIC_BASE_URL` reachable from the internet, then `COMMS_LIVE=true`.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/health` | which modes are live |
| GET | `/api/questionnaire`, `/api/catalog` | intake form, roles and event types |
| POST | `/api/events` | `{ brief, fastForward? }` → `{ id }` |
| GET | `/api/events`, `/api/events/:id` | list / full event state |
| GET | `/api/events/:id/stream` | server-sent change notifications |
| POST | `/api/events/:id/approvals/:approvalId` | `{ approve, note? }` — the note is passed to the agent |
| POST | `/api/events/:id/pause` · `/resume` · `/tasks/:taskId/retry` | control |
| POST | `/api/events/:id/vendors` | host adds a vendor they already like |
| POST | `/api/events/:id/simulate-reply` | dev: inject a vendor reply (simulation only) |
| POST | `/webhooks/twilio/sms` · `/voice` · `/status`, `/webhooks/email/inbound` | providers |

## Project layout

```
src/
  server.ts            Express app: API, webhooks, static UI
  orchestrator.ts      lifecycle, scheduling, approvals, inbound routing
  agents/              director (blueprint), planner (roster + task graph), specialist (Claude loop), tools, simulator
  catalog/             roles, event types, questionnaire
  comms/               email/SMS/voice providers, voice agent, simulated vendor replies
  vendors/directory.ts Google Places search + simulated directory
  store.ts             JSON-file event store with per-event serialized writes
public/                questionnaire + live dashboard (vanilla JS, no build step)
test/                  node:test suite
```

## Known limits / next steps

- **No authentication yet** — add host accounts before exposing this publicly (events contain contact details).
- JSON-file storage is single-process; swap `store.ts` for Postgres to run multiple instances.
- Payments are recorded as approvals and budget entries only; wire Stripe (Connect) to actually pay deposits.
- Contracts: agents flag terms for the host; e-signature (DocuSign/Dropbox Sign) is a natural next integration.
- Ticketing and social posting produce approved drafts; connect Eventbrite/Luma and Meta/LinkedIn APIs to publish.
- Real-time conversational voice (streaming speech) can replace the `<Gather>` loop via Twilio Media Streams.
