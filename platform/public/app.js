// Eventifyre web app: landing + intake, event list, and the live dashboard of the AI event team.
// Vanilla JS, no build step. Everything rendered from vendor/agent data is escaped.

const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const api = async (path, opts = {}) => {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { data });
  return data;
};
const money = (n, c = "USD") => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c, maximumFractionDigits: 0 }).format(n || 0); } catch { return `${c} ${Math.round(n || 0)}`; } };
const label = (s) => esc(String(s ?? "").replace(/_/g, " "));
const pill = (s) => `<span class="pill ${esc(s)}">${label(s)}</span>`;
const PHASES = ["concept", "planning", "sourcing", "booking", "promotion", "preparation", "execution", "wrapup"];

// Unsplash photography (verified IDs), served from Unsplash's image CDN.
const unsplash = (id, w = 1200, h) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}${h ? `&h=${h}` : ""}&q=72`;
const PHOTOS = {
  ballroom: "1519167758481-83f550bb49b3",
  aisle: "1469371670807-013ccf25f16a",
  table: "1511795409834-ef04bbd61622",
  catering: "1555244162-803834f70033",
  dinnerToast: "1527529482837-4698179dc6ce",
  confetti: "1505236858219-8359eb29e329",
  conference: "1540575467063-178a50c2df87",
  meetup: "1515169067868-5387ec356754",
  balloons: "1530103862676-de8c9debad1d",
  concert: "1470229722913-7c0e2dbbafd3",
  festival: "1501281668745-f7f57925c3b4",
  florals: "1487530811176-3780de880c2d",
  friends: "1528605248644-14dd04022da1",
  plated: "1414235077428-338989a2e8c0",
  hearts: "1429962714451-bb934ecdc4ec",
  holi: "1496024840928-4c417adf211d",
};
const COVER_BY_TYPE = {
  wedding: "aisle", conference: "conference", workshop: "meetup", trade_show: "conference", hackathon: "meetup",
  corporate_offsite: "meetup", networking: "meetup", birthday: "balloons", baby_shower: "balloons", concert: "concert",
  festival: "festival", gala_fundraiser: "ballroom", religious_cultural: "holi", product_launch: "confetti",
  private_party: "dinnerToast", graduation: "dinnerToast", memorial: "florals", sports: "friends", community: "friends",
};
const coverFor = (type, w, h) => unsplash(PHOTOS[COVER_BY_TYPE[type] ?? "table"], w, h);

let stream = null;
let currentTab = "overview";
let navObserver = null;

api("/api/health").then((h) => {
  document.getElementById("mode").innerHTML = `Agents: ${esc(h.agents)}<br>Comms ${h.comms.live ? "live" : "simulated"}, vendors ${esc(h.vendorSearch)}`;
}).catch(() => {});

window.addEventListener("hashchange", route);
route();

function route() {
  if (stream) { stream.close(); stream = null; }
  if (navObserver) { navObserver.disconnect(); navObserver = null; }
  const [, page, id] = location.hash.split("/");
  document.querySelectorAll("[data-nav]").forEach((a) => a.removeAttribute("aria-current"));
  if (page === "events") { setNav("solid", "events"); return renderEvents(); }
  if (page === "event" && id) { setNav("solid", "events"); return renderEvent(id); }
  renderLanding(page === "plan" ? "plan" : page === "how" ? "how" : null);
}

function setNav(mode, current) {
  $nav.classList.toggle("is-solid", mode === "solid");
  $nav.classList.toggle("on-media", mode === "media");
  if (current) document.querySelector(`[data-nav="${current}"]`)?.setAttribute("aria-current", "page");
}

/** Fade sections in as they enter the viewport; play videos only while visible. */
function enhance(root) {
  const items = root.querySelectorAll("[data-reveal]");
  if (reduceMotion) items.forEach((el) => el.classList.add("is-in"));
  else {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    items.forEach((el) => io.observe(el));
  }
  if (reduceMotion) return; // videos keep their poster frame
  const vo = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? e.target.play().catch(() => {}) : e.target.pause();
  }, { threshold: 0.1 });
  root.querySelectorAll("video[data-autoplay]").forEach((v) => vo.observe(v));
}

// ───────────────────────── Landing + intake ─────────────────────────
const EVENT_CHIPS = [
  ["Weddings", "aisle"], ["Conferences", "conference"], ["Birthdays", "balloons"], ["Galas", "ballroom"],
  ["Concerts", "concert"], ["Festivals", "festival"], ["Product launches", "confetti"], ["Dinners", "plated"],
  ["Meetups", "meetup"], ["Cultural celebrations", "holi"], ["Memorials", "florals"], ["Reunions", "friends"],
];

async function renderLanding(scrollTo) {
  const questions = await api("/api/questionnaire");
  const chip = (hidden) => EVENT_CHIPS.map(([name, p]) => `<span class="chip"${hidden ? ' aria-hidden="true"' : ""}><img src="${unsplash(PHOTOS[p], 96, 96)}" alt="" loading="lazy" width="36" height="36">${name}</span>`).join("");

  $app.innerHTML = `
    <section class="hero" id="top">
      <video class="hero__video" data-autoplay muted loop playsinline preload="metadata" poster="media/hero-toast.jpg" aria-hidden="true">
        <source src="media/hero-toast.mp4" type="video/mp4">
      </video>
      <div class="hero__inner">
        <h1 data-rise style="--i:0">Describe the event. <em>Your AI team runs it.</em></h1>
        <p data-rise style="--i:1">Venue, catering, vendors, marketing and the day itself, planned and booked by agents who check with you first.</p>
        <div class="hero__ctas" data-rise style="--i:2">
          <a class="btn btn--primary" href="#/plan">Plan my event <i class="ph ph-arrow-right"></i></a>
          <a class="btn btn--glass" href="#/how">How it works</a>
        </div>
      </div>
    </section>

    <div class="marquee" aria-label="Events we plan"><div class="marquee__track">${chip(false)}${chip(true)}</div></div>

    <section class="section">
      <div class="wrap">
        <span class="eyebrow" data-reveal>Your AI team</span>
        <h2 data-reveal>A full production team, staffed in seconds.</h2>
        <p class="lede" data-reveal>Every role a professional event company would hire is mapped to an agent, so the unglamorous work gets done too.</p>
        <div class="bento">
          <article class="tile tile--media tile--a" data-reveal>
            <img src="${unsplash(PHOTOS.ballroom, 1400, 1000)}" alt="Ballroom set with round tables and chandeliers" loading="lazy">
            <div><h3>Venue &amp; production</h3><p>Venue scout, AV, rentals and staging agents shortlist spaces, request floor plans and bring you quotes.</p></div>
          </article>
          <article class="tile tile--media" data-reveal style="--i:1">
            <video data-autoplay muted loop playsinline preload="none" poster="media/decor-ceiling.jpg" aria-hidden="true"><source src="media/decor-ceiling.mp4" type="video/mp4"></video>
            <div><h3>Decor &amp; florals</h3><p>Briefed from one style guide.</p></div>
          </article>
          <article class="tile tile--accent" data-reveal style="--i:2">
            <i class="ph ph-users-three" style="font-size:1.8rem"></i>
            <div><div class="big">33</div><p>specialist roles, from permits officer to show caller.</p></div>
          </article>
          <article class="tile tile--media" data-reveal style="--i:1">
            <img src="${unsplash(PHOTOS.catering, 800, 600)}" alt="Catering buffet with silver chafing dishes" loading="lazy">
            <div><h3>Food &amp; drink</h3><p>Menus, dietary plans, bar and cake.</p></div>
          </article>
          <article class="tile tile--media" data-reveal style="--i:2">
            <video data-autoplay muted loop playsinline preload="none" poster="media/conference.jpg" aria-hidden="true"><source src="media/conference.mp4" type="video/mp4"></video>
            <div><h3>Guests &amp; marketing</h3><p>Invitations, RSVPs, speakers and tickets.</p></div>
          </article>
          <article class="tile tile--wide" data-reveal>
            <div><h3>Operations, start to finish</h3><p class="sub">Nothing falls between departments.</p></div>
            <div class="roles">${["Permits & insurance", "Budget & payments", "Accessibility", "Safety & security", "Logistics & load-out", "Weather plan", "Day-of coordinator", "Thank-yous & report"].map((r) => `<span class="tag">${esc(r)}</span>`).join("")}</div>
          </article>
        </div>
      </div>
    </section>

    <section class="section" id="how" style="padding-top:0">
      <div class="wrap how">
        <figure class="how__media" data-reveal><img src="${unsplash(PHOTOS.dinnerToast, 1000, 1250)}" alt="Guests raising glasses at a candlelit dinner" loading="lazy"></figure>
        <div>
          <h2 data-reveal>From a paragraph to a party.</h2>
          <div class="steps">
            ${[
              ["ph-chat-text", "Describe it", "Write what you picture, the way you'd tell a friend. Add a date, a city and a budget if you have them."],
              ["ph-users-four", "Meet your team", "We staff the roles your event needs and lay out every task, worked back from the date."],
              ["ph-envelope-simple", "Agents reach out", "They email, text and call vendors, compare quotes and negotiate, then bring you a recommendation."],
              ["ph-check-circle", "You approve", "Bookings, payments, contracts and public posts wait for your yes. Add a note and the agent follows it."],
              ["ph-confetti", "Enjoy the day", "Run-of-show, vendor reconfirmations, day-of coordination, payments and thank-you notes are handled."],
            ].map(([icon, title, text], i) => `<div class="step" data-reveal style="--i:${i}"><span class="step__icon"><i class="ph ${icon}"></i></span><div><h3>${title}</h3><p>${text}</p></div></div>`).join("")}
          </div>
        </div>
      </div>
    </section>

    <section class="band">
      <img src="${unsplash(PHOTOS.hearts, 2000, 1100)}" alt="" loading="lazy">
      <div class="wrap">
        <h2 data-reveal>Nothing is booked, paid or posted without your yes.</h2>
        <div class="band__facts">
          <div data-reveal style="--i:0"><b>Honest outreach</b>Every call opens by saying it's an AI assistant acting for you.</div>
          <div data-reveal style="--i:1"><b>Respectful by default</b>Vendors who reply STOP are never contacted again.</div>
          <div data-reveal style="--i:2"><b>Your pace</b>Approve every message, only commitments, or small bookings within budget.</div>
        </div>
      </div>
    </section>

    <section class="section" id="plan">
      <div class="wrap plan">
        <aside class="plan__aside">
          <h2 data-reveal>Tell us about your event.</h2>
          <p class="lede" data-reveal>Only the description, city and your contact details are required. Your team fills the gaps and asks about anything that matters.</p>
          <figure data-reveal><img src="${unsplash(PHOTOS.table, 1000, 750)}" alt="Long dinner table with flowers and glassware" loading="lazy"></figure>
        </aside>
        <form class="form" id="intake" novalidate data-reveal>
          ${intakeFields(questions)}
          <label class="check"><input type="checkbox" name="fastForward"><span>Demo mode: run day-of and wrap-up tasks now instead of waiting for the date</span></label>
          <div class="form__submit">
            <button class="btn btn--primary" type="submit">Assemble my team <i class="ph ph-arrow-right"></i></button>
            <span class="form__error" id="err" role="alert"></span>
          </div>
        </form>
      </div>
    </section>

    <footer class="footer"><div class="wrap">
      <a href="#/" class="logo"><span class="logo__mark" aria-hidden="true">E</span>Eventifyre</a>
      <span>Photography from Unsplash. Video from Mixkit.</span>
      <span>&copy; 2026 Eventifyre</span>
    </div></footer>`;

  // Transparent nav over the hero, frosted once the hero scrolls away.
  setNav("media", "home");
  navObserver = new IntersectionObserver(([e]) => setNav(e.isIntersecting ? "media" : "solid", "home"), { rootMargin: "-68px 0px 0px 0px" });
  navObserver.observe(document.getElementById("top"));

  enhance($app);
  bindIntake(questions);
  if (scrollTo) requestAnimationFrame(() => document.getElementById(scrollTo)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }));
}

/** Short fields that sit side by side in a two-column row. */
const PAIRED = new Set(["date", "city", "guestCount", "budget", "currency", "hostEmail", "hostPhone", "dietaryNeeds", "accessibilityNeeds"]);

function intakeFields(questions) {
  const sections = { vision: "Your vision", basics: "The basics", guests: "Guests", details: "Details", contact: "About you", autonomy: "How hands-on do you want to be?" };
  const field = (q) => {
    if (q.type === "checkbox") return `<label class="check"><input type="checkbox" name="${q.id}"><span>${esc(q.label)}</span></label>`;
    const id = `f-${q.id}`;
    const help = q.help ? `<span class="help" id="${id}-help">${esc(q.help)}</span>` : "";
    const attrs = `id="${id}" name="${q.id}" ${q.required ? "required" : ""} ${q.placeholder ? `placeholder="${esc(q.placeholder)}"` : ""} ${q.help ? `aria-describedby="${id}-help"` : ""}`;
    let input;
    if (q.type === "textarea") input = `<textarea ${attrs} class="${q.id === "vision" ? "vision" : ""}"></textarea>`;
    else if (q.type === "select") input = `<select ${attrs}>${q.options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select>`;
    else input = `<input type="${q.type}" ${attrs} ${q.type === "number" ? 'min="1" inputmode="numeric"' : ""}>`;
    return `<div class="field"><label for="${id}">${esc(q.label)}${q.required ? ' <span aria-hidden="true" style="color:var(--accent)">*</span>' : ""}</label>${help}${input}<span class="err" id="${id}-err"></span></div>`;
  };
  return Object.entries(sections).map(([s, title]) => {
    // Keep questionnaire order; group consecutive short fields into two-column rows.
    const qs = questions.filter((q) => q.section === s);
    // Checkboxes wait until the row they interrupt is complete.
    let html = "";
    let row = [];
    let checks = [];
    const flush = () => {
      if (row.length) html += row.length > 1 ? `<div class="grid-2">${row.map(field).join("")}</div>` : field(row[0]);
      html += checks.map(field).join("");
      row = []; checks = [];
    };
    for (const q of qs) {
      if (PAIRED.has(q.id)) { row.push(q); if (row.length === 2) flush(); }
      else if (q.type === "checkbox" && row.length) checks.push(q);
      else { flush(); html += field(q); }
    }
    flush();
    return `<fieldset><legend>${title}</legend>${html}</fieldset>`;
  }).join("");
}

function bindIntake(questions) {
  const form = document.getElementById("intake");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    form.querySelectorAll(".err").forEach((el) => (el.textContent = ""));
    document.getElementById("err").textContent = "";
    const fd = new FormData(form);
    const brief = {};
    for (const q of questions) {
      if (q.type === "checkbox") brief[q.id] = fd.get(q.id) === "on";
      else if (fd.get(q.id)) brief[q.id] = q.type === "number" ? Number(fd.get(q.id)) : fd.get(q.id);
    }
    const missing = questions.filter((q) => q.required && !brief[q.id]);
    if (missing.length) {
      for (const q of missing) document.getElementById(`f-${q.id}-err`).textContent = "Please fill this in.";
      document.getElementById(`f-${missing[0].id}`).focus();
      return;
    }
    btn.disabled = true;
    btn.innerHTML = `Assembling your team <i class="ph ph-spinner-gap"></i>`;
    try {
      const { id } = await api("/api/events", { method: "POST", body: { brief, fastForward: fd.get("fastForward") === "on" } });
      location.hash = `#/event/${id}`;
      window.scrollTo(0, 0);
    } catch (err) {
      const issues = err.data?.issues ?? [];
      for (const i of issues) { const el = document.getElementById(`f-${i.field}-err`); if (el) el.textContent = i.message; }
      document.getElementById("err").textContent = issues.length ? "Please check the highlighted fields." : err.message;
      btn.disabled = false;
      btn.innerHTML = `Assemble my team <i class="ph ph-arrow-right"></i>`;
    }
  });
}

// ───────────────────────── Event list ─────────────────────────
async function renderEvents() {
  $app.innerHTML = `<div class="page"><div class="wrap"><h1>My events</h1><div class="event-list">${[0, 1, 2].map(() => `<div class="skel" style="height:280px;border-radius:16px"></div>`).join("")}</div></div></div>`;
  const events = await api("/api/events");
  $app.innerHTML = `<div class="page"><div class="wrap"><h1>My events</h1>${events.length ? `<div class="event-list">${events.map((e, i) => `
    <a class="event-card" href="#/event/${esc(e.id)}" data-reveal style="--i:${i % 6}">
      <img src="${coverFor(e.eventType, 800, 450)}" alt="" loading="lazy">
      <div class="body">
        <h3>${esc(e.title)}</h3>
        <div class="sub">${esc(e.date ?? "Date to be decided")}, ${esc(e.city)}</div>
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${pill(e.status)}${e.pendingApprovals ? `<span class="pill pending">${e.pendingApprovals} awaiting you</span>` : ""}</div>
      </div>
    </a>`).join("")}</div>` : `<div class="empty" style="margin-top:32px"><i class="ph ph-calendar-plus"></i>No events yet. <a href="#/plan">Plan your first one</a>.</div>`}</div></div>`;
  enhance($app);
}

// ───────────────────────── Event dashboard ─────────────────────────
let reload = null;
let reloadPending = false;
document.addEventListener("focusout", () => {
  if (reloadPending && reload) { reloadPending = false; setTimeout(reload, 150); }
});

async function renderEvent(id) {
  currentTab = "overview";
  $app.innerHTML = skeletonDashboard();
  const load = async () => {
    try { draw(await api(`/api/events/${id}`)); } catch (e) { $app.innerHTML = `<div class="page"><div class="wrap"><div class="empty"><i class="ph ph-warning-circle"></i>${esc(e.message)}</div></div></div>`; }
  };
  reload = load;
  await load();
  stream = new EventSource(`/api/events/${id}/stream`);
  stream.onmessage = () => {
    // Don't clobber a note the host is typing.
    if (document.activeElement?.tagName === "TEXTAREA") { reloadPending = true; return; }
    load();
  };
}

function skeletonDashboard(ev) {
  return `<div class="page"><div class="wrap">
    <div class="cover"><img src="${unsplash(PHOTOS.table, 1600, 600)}" alt=""><div class="cover__inner"><div>
      <div class="cover__meta">${ev ? pill(ev.status) : ""}</div>
      <h1>${ev ? "Your Event Director is reading your vision" : "Loading your event"}</h1>
      ${ev ? `<p style="margin-top:8px;max-width:60ch;color:rgb(255 255 255 / .8)">${esc(ev.brief.vision)}</p>` : ""}
      ${ev?.error ? `<p style="margin-top:8px;color:#ffb3bf">${esc(ev.error)}</p>` : ""}
    </div></div></div>
    <div class="stats">${[0, 1, 2, 3, 4].map(() => `<div class="stat"><div class="skel" style="height:28px;width:60%"></div><div class="skel" style="height:12px;width:80%;margin-top:10px"></div></div>`).join("")}</div>
    <div class="cols" style="margin-top:24px"><div class="skel" style="height:320px;border-radius:16px"></div><div class="skel" style="height:320px;border-radius:16px"></div></div>
  </div></div>`;
}

function draw(ev) {
  const bp = ev.blueprint;
  if (!bp) { $app.innerHTML = skeletonDashboard(ev); return; }
  const cur = bp.currency ?? ev.brief.currency ?? "USD";
  const done = ev.tasks.filter((t) => t.status === "done").length;
  const pendingApprovals = ev.approvals.filter((a) => a.status === "pending");
  const committed = ev.budget.reduce((s, b) => s + b.committed, 0);
  const scrollY = window.scrollY;

  const tabs = [
    ["overview", "Overview", "ph-squares-four"], ["approvals", "Approvals", "ph-seal-check", pendingApprovals.length], ["team", "AI team", "ph-users-three"],
    ["tasks", "Tasks", "ph-kanban"], ["comms", "Messages", "ph-chats-circle"], ["vendors", "Vendors", "ph-storefront"], ["budget", "Budget", "ph-wallet"],
    ["timeline", "Timeline", "ph-calendar-dots"], ["marketing", "Marketing", "ph-megaphone"], ["risks", "Risks", "ph-shield-warning"], ["activity", "Activity", "ph-pulse"],
  ];
  const body = { overview, approvals, team, tasks, comms: commsTab, vendors, budget, timeline, marketing, risks, activity }[currentTab](ev, cur);

  $app.innerHTML = `<div class="page"><div class="wrap">
    <div class="cover">
      <img src="${coverFor(bp.eventType, 1600, 600)}" alt="">
      <div class="cover__inner">
        <div>
          <div class="cover__meta">${label(bp.eventType)}, ${esc(bp.date ?? "date to be decided")}, ${esc(bp.city)}, ${esc(bp.guestCount)} guests</div>
          <h1>${esc(bp.title)}</h1>
        </div>
        <div class="cover__actions">
          ${pill(ev.status)}
          ${ev.status === "paused" ? `<button class="btn btn--primary btn--sm" data-act="resume"><i class="ph ph-play"></i>Resume agents</button>` : ev.status === "completed" ? "" : `<button class="btn btn--glass btn--sm" data-act="pause"><i class="ph ph-pause"></i>Pause agents</button>`}
        </div>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="v">${ev.roster.length}</div><div class="l">Agents on your team</div></div>
      <div class="stat"><div class="v">${done}/${ev.tasks.length}</div><div class="l">Tasks complete</div><div class="meter"><i style="width:${(done / Math.max(1, ev.tasks.length)) * 100}%"></i></div></div>
      <div class="stat"><div class="v" style="${pendingApprovals.length ? "color:var(--accent)" : ""}">${pendingApprovals.length}</div><div class="l">Waiting on you</div></div>
      <div class="stat"><div class="v">${ev.communications.filter((c) => c.direction === "outbound").length}</div><div class="l">Messages and calls</div></div>
      <div class="stat"><div class="v">${money(committed, cur)}</div><div class="l">Committed of ${money(bp.budget, cur)}</div><div class="meter"><i style="width:${Math.min(100, (committed / Math.max(1, bp.budget)) * 100)}%"></i></div></div>
    </div>
    <div class="tabs" role="tablist">${tabs.map(([k, l, icon, n]) => `<button role="tab" aria-selected="${k === currentTab}" data-tab="${k}" class="${k === currentTab ? "active" : ""}"><i class="ph ${icon}"></i>${l}${n ? `<span class="count">${n}</span>` : ""}</button>`).join("")}</div>
    <div>${body}</div>
  </div></div>`;
  window.scrollTo(0, scrollY);

  $app.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { currentTab = b.dataset.tab; draw(ev); }));
  $app.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => api(`/api/events/${ev.id}/${b.dataset.act}`, { method: "POST" })));
  $app.querySelectorAll("[data-retry]").forEach((b) => b.addEventListener("click", () => api(`/api/events/${ev.id}/tasks/${b.dataset.retry}/retry`, { method: "POST" })));
  $app.querySelectorAll("[data-decide]").forEach((b) => b.addEventListener("click", async () => {
    const [aid, verdict] = b.dataset.decide.split(":");
    const note = document.getElementById(`note-${aid}`)?.value || undefined;
    b.disabled = true;
    try { await api(`/api/events/${ev.id}/approvals/${aid}`, { method: "POST", body: { approve: verdict === "yes", note } }); } catch (e) { alert(e.message); }
  }));
}

const empty = (icon, text) => `<div class="empty"><i class="ph ${icon}"></i>${text}</div>`;

function overview(ev) {
  const bp = ev.blueprint;
  const list = (xs) => xs?.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<span class="sub">None</span>`;
  const next = ev.tasks.filter((t) => !["done", "skipped"].includes(t.status)).sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9")).slice(0, 6);
  return `
    <div class="cols">
      <div class="panel prose"><h3>Blueprint</h3><p>${esc(bp.summary)}</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 4px">
          <span class="tag">Theme: ${esc(bp.theme)}</span><span class="tag">${esc(bp.audience)}</span><span class="tag">${bp.ticketed ? "Ticketed" : "Invite only"}</span><span class="tag">${esc(bp.durationHours)} hours</span>
        </div>
        <h3 style="margin-top:20px">Goals</h3>${list(bp.goals)}
        <h3 style="margin-top:20px">Guest journey</h3>${list(bp.experienceMoments)}
      </div>
      <div class="stack">
        <div class="panel prose"><h3>Questions for you</h3>${list(bp.openQuestions)}</div>
        <div class="panel prose"><h3>Constraints we're honoring</h3>${list(bp.constraints)}</div>
        <div class="panel"><h3>Up next</h3><div class="stack">${next.map((t) => `<div class="row"><div class="top"><span>${esc(t.title)}</span>${pill(t.status)}</div><div class="sub">${label(t.roleId)}, due ${esc(t.dueDate ?? "when ready")}</div></div>`).join("") || `<span class="sub">Everything is done.</span>`}</div></div>
      </div>
    </div>`;
}

function approvals(ev, cur) {
  const pending = ev.approvals.filter((a) => a.status === "pending");
  const decided = ev.approvals.filter((a) => a.status !== "pending").reverse();
  const card = (a) => `
    <div class="row approval">
      <div class="top"><strong>${esc(a.title)}</strong>${pill(a.status)}</div>
      <div class="sub">${label(a.kind)}, requested by ${label(a.roleId)}${a.amount ? `, <span class="amount">${money(a.amount, cur)}</span>` : ""}</div>
      <pre>${esc(a.details)}</pre>
      ${a.options?.length ? `<div class="sub" style="margin-top:6px">Options: ${a.options.map(esc).join(" / ")}</div>` : ""}
      ${a.status === "pending" ? `<label class="sub" for="note-${esc(a.id)}" style="display:block;margin-top:12px">Note to the agent (optional)</label><textarea id="note-${esc(a.id)}" placeholder="For example: negotiate 10% lower, or go with option B"></textarea>
        <div class="btns"><button class="btn btn--ok btn--sm" data-decide="${esc(a.id)}:yes"><i class="ph ph-check"></i>Approve</button><button class="btn btn--danger btn--sm" data-decide="${esc(a.id)}:no">Decline</button></div>`
        : a.decisionNote ? `<div class="sub" style="margin-top:6px">Note: ${esc(a.decisionNote)}</div>` : ""}
    </div>`;
  return `<div class="stack">${pending.map(card).join("") || empty("ph-seal-check", "Nothing needs your approval right now. Your agents will ask before anything is booked, paid, signed or published.")}</div>
    ${decided.length ? `<h3 style="margin:32px 0 12px">History</h3><div class="stack">${decided.map(card).join("")}</div>` : ""}`;
}

function team(ev) {
  const depts = [...new Set(ev.roster.map((a) => a.department))];
  return `<div class="team">${depts.map((d) => `<div class="dept">${esc(d)}</div>` + ev.roster.filter((a) => a.department === d).map((a) => {
    const ts = ev.tasks.filter((t) => t.roleId === a.roleId);
    const pct = (ts.filter((t) => t.status === "done").length / Math.max(1, ts.length)) * 100;
    return `<div class="row"><div class="top"><strong>${esc(a.title)}</strong>${pill(a.status)}</div>
      <p class="sub" style="margin:6px 0">${esc(a.mission)}</p>
      <div class="sub">${esc(a.reason)}</div>
      <div class="meter"><i style="width:${pct}%"></i></div></div>`;
  }).join("")).join("")}</div>`;
}

function tasks(ev) {
  return `<div class="board">${PHASES.map((p) => {
    const ts = ev.tasks.filter((t) => t.phase === p);
    return `<div class="col"><h4><span>${label(p)}</span><span class="mono sub">${ts.filter((t) => t.status === "done").length}/${ts.length}</span></h4>${ts.map((t) => `
      <div class="row"><div class="top"><span>${esc(t.title)}</span>${pill(t.status)}</div>
      <div class="sub">${label(t.roleId)}, due ${esc(t.dueDate ?? "when ready")}</div>
      ${t.output ? `<pre>${esc(t.output)}</pre>` : ""}
      ${t.status === "blocked" || t.status === "waiting_vendor" ? `<button class="btn btn--ghost btn--sm" style="margin-top:8px" data-retry="${esc(t.id)}"><i class="ph ph-arrow-clockwise"></i>Retry</button>` : ""}
      </div>`).join("") || `<p class="sub" style="padding:4px">No tasks in this phase.</p>`}</div>`;
  }).join("")}</div>`;
}

function commsTab(ev) {
  const vname = (id) => ev.vendors.find((v) => v.id === id)?.name;
  const icon = { email: "ph-envelope-simple", sms: "ph-chat-centered-text", voice: "ph-phone", internal: "ph-note" };
  const msgs = [...ev.communications].reverse();
  return msgs.length ? `<div class="stack">${msgs.map((c) => `
    <div class="row"><div class="top"><span><i class="ph ${icon[c.channel] ?? "ph-chat"}" style="color:var(--accent)"></i> ${c.direction === "outbound" ? "To" : "From"} <strong>${esc(vname(c.vendorId) ?? c.to ?? c.from ?? "")}</strong></span>${pill(c.status)}</div>
      <div class="sub">${label(c.roleId)}, ${new Date(c.createdAt).toLocaleString()}</div>
      ${c.subject ? `<div style="margin-top:8px;font-weight:600">${esc(c.subject)}</div>` : ""}<pre>${esc(c.body)}</pre></div>`).join("")}</div>`
    : empty("ph-chats-circle", "No messages yet. Agents start reaching out once the plan is ready.");
}

function vendors(ev) {
  const rows = ev.vendors.map((v) => {
    const qs = ev.quotes.filter((q) => q.vendorId === v.id);
    return `<tr><td><strong>${esc(v.name)}</strong><div class="sub">${esc(v.website ?? "")}</div></td><td style="text-transform:capitalize">${esc(v.category)}</td><td class="num">${esc(v.rating ?? "n/a")}</td>
      <td>${qs.map((q) => `<span class="amount">${money(q.amount, q.currency)}</span> ${pill(q.status)}`).join("<br>") || `<span class="sub">None yet</span>`}</td><td>${v.doNotContact ? pill("blocked") : `<span class="sub">${label(v.source)}</span>`}</td></tr>`;
  }).join("");
  return ev.vendors.length ? `<div class="panel table-wrap"><table><thead><tr><th>Vendor</th><th>Category</th><th class="num">Rating</th><th>Quotes</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty("ph-storefront", "Agents haven't searched for vendors yet.");
}

function budget(ev, cur) {
  const sum = (k) => ev.budget.reduce((s, b) => s + (b[k] || 0), 0);
  return `<div class="panel table-wrap"><table><thead><tr><th>Category</th><th>Notes</th><th class="num">Planned</th><th class="num">Committed</th><th class="num">Paid</th></tr></thead><tbody>
    ${ev.budget.map((b) => `<tr><td>${esc(b.category)}</td><td class="sub">${esc(b.description)}</td><td class="num mono">${money(b.estimated, cur)}</td><td class="num mono" style="${b.committed > b.estimated ? "color:var(--bad)" : ""}">${money(b.committed, cur)}</td><td class="num mono">${money(b.paid, cur)}</td></tr>`).join("")}
    <tr><td><strong>Total</strong></td><td class="sub">Budget ${money(ev.blueprint.budget, cur)}</td><td class="num mono"><strong>${money(sum("estimated"), cur)}</strong></td><td class="num mono"><strong>${money(sum("committed"), cur)}</strong></td><td class="num mono"><strong>${money(sum("paid"), cur)}</strong></td></tr>
  </tbody></table></div>`;
}

function timeline(ev) {
  const block = (kind, title, icon) => {
    const items = ev.timeline.filter((t) => t.kind === kind);
    return `<div class="panel"><h3><i class="ph ${icon}" style="color:var(--accent)"></i> ${title}</h3><div class="stack">${items.length ? items.map((t) => `<div class="row"><div class="top"><span class="mono">${esc(t.when)}</span><span class="sub">${label(t.owner)}</span></div><div style="margin-top:4px">${esc(t.title)}</div>${t.notes ? `<div class="sub">${esc(t.notes)}</div>` : ""}</div>`).join("") : `<p class="sub">Not built yet.</p>`}</div></div>`;
  };
  return `<div class="cols">${block("milestone", "Planning milestones", "ph-flag-banner")}${block("run_of_show", "Run of show", "ph-clock")}</div>`;
}

function marketing(ev) {
  return ev.marketing.length ? `<div class="stack">${ev.marketing.map((m) => `<div class="row"><div class="top"><strong>${esc(m.title)}</strong>${pill(m.status)}</div><div class="sub">${label(m.kind)}, ${esc(m.channel)}${m.scheduledFor ? `, ${esc(m.scheduledFor)}` : ""}</div><pre>${esc(m.content)}</pre></div>`).join("")}</div>` : empty("ph-megaphone", "No invitations or marketing drafted yet.");
}

function risks(ev) {
  return ev.risks.length ? `<div class="stack">${ev.risks.map((r) => `<div class="row"><div class="top"><strong>${esc(r.description)}</strong><span style="display:flex;gap:6px">${pill(r.likelihood)}${pill(r.impact)}</span></div><div class="sub">Likelihood and impact. Logged by ${label(r.roleId)}</div><pre>Mitigation: ${esc(r.mitigation)}</pre></div>`).join("")}</div>` : empty("ph-shield-check", "No risks logged yet.");
}

function activity(ev) {
  const items = [...ev.activity].reverse().slice(0, 300);
  return items.length ? `<div class="feed">${items.map((a) => `<div class="entry"><span class="time">${new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><span class="who">${label(a.roleId)}</span><span>${esc(a.text)}</span></div>`).join("")}</div>` : empty("ph-pulse", "No activity yet.");
}
