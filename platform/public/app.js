// Eventifyre web app: questionnaire intake + live dashboard of the AI event team.
// Vanilla JS, no build step. Everything rendered from vendor/agent data is escaped.

const $app = document.getElementById("app");
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

let stream = null;
let currentTab = "overview";

api("/api/health").then((h) => {
  document.getElementById("mode").innerHTML = `Agents: ${esc(h.agents)}<br>Comms: ${h.comms.live ? "live" : "simulated"} · Vendors: ${esc(h.vendorSearch)}`;
}).catch(() => {});

window.addEventListener("hashchange", route);
route();

function route() {
  if (stream) { stream.close(); stream = null; }
  const [, page, id] = location.hash.split("/");
  if (page === "events") return renderEvents();
  if (page === "event" && id) return renderEvent(id);
  renderIntake();
}

// ───────────────────────── Intake ─────────────────────────
async function renderIntake() {
  const questions = await api("/api/questionnaire");
  const sections = { vision: "Your vision", basics: "The basics", guests: "Guests", details: "Details", contact: "About you", autonomy: "Your AI team's autonomy" };
  const field = (q) => {
    const req = q.required ? "required" : "";
    const ph = q.placeholder ? `placeholder="${esc(q.placeholder)}"` : "";
    if (q.type === "checkbox") return `<label class="check"><input type="checkbox" name="${q.id}"> ${esc(q.label)}</label>`;
    const help = q.help ? `<div class="help">${esc(q.help)}</div>` : "";
    let input;
    if (q.type === "textarea") input = `<textarea id="${q.id}" name="${q.id}" ${req} ${ph}></textarea>`;
    else if (q.type === "select") input = `<select name="${q.id}">${q.options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select>`;
    else input = `<input type="${q.type}" name="${q.id}" ${req} ${ph} ${q.type === "number" ? 'min="1"' : ""}>`;
    return `<label for="${q.id}">${esc(q.label)}${q.required ? " *" : ""}</label>${help}${input}`;
  };
  const bySection = Object.keys(sections).map((s) => `<fieldset><legend>${sections[s]}</legend>${questions.filter((q) => q.section === s).map(field).join("")}</fieldset>`).join("");

  $app.innerHTML = `
    <section class="hero">
      <div>
        <h1>Describe your event.<br><span>Your AI team does the rest.</span></h1>
        <p class="lead">Tell us your vision in plain words. Eventifyre staffs a full production team of AI agents — venue scout, caterer, decorator, talent booker, marketer, permits officer, day-of coordinator and more — that find vendors, email, text and call them, collect quotes and run your event from idea to thank-you notes.</p>
        <div class="steps">
          <div class="step"><b>1</b><div><strong>Share your vision</strong><br><span class="sub">Any event: weddings, conferences, birthdays, launches, festivals, memorials.</span></div></div>
          <div class="step"><b>2</b><div><strong>Meet your AI team</strong><br><span class="sub">Every role a real production needs, mapped to an agent — nothing missed.</span></div></div>
          <div class="step"><b>3</b><div><strong>Approve, don't chase</strong><br><span class="sub">Agents negotiate and bring you recommendations. Nothing is booked or paid without your OK.</span></div></div>
          <div class="step"><b>4</b><div><strong>Enjoy the day</strong><br><span class="sub">Run-of-show, vendor confirmations, day-of coordination and wrap-up handled.</span></div></div>
        </div>
      </div>
      <form class="card form" id="intake">
        ${bySection}
        <label class="check"><input type="checkbox" name="fastForward"> Demo mode: don't wait for the calendar (run day-of and wrap-up tasks now)</label>
        <div style="margin-top:18px"><button class="btn" type="submit">Assemble my AI event team →</button></div>
        <div class="error" id="err"></div>
      </form>
    </section>`;

  document.getElementById("intake").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    const fd = new FormData(e.target);
    const brief = {};
    for (const q of questions) {
      if (q.type === "checkbox") brief[q.id] = fd.get(q.id) === "on";
      else if (fd.get(q.id)) brief[q.id] = q.type === "number" ? Number(fd.get(q.id)) : fd.get(q.id);
    }
    btn.disabled = true;
    try {
      const { id } = await api("/api/events", { method: "POST", body: { brief, fastForward: fd.get("fastForward") === "on" } });
      location.hash = `#/event/${id}`;
    } catch (err) {
      document.getElementById("err").textContent = err.data?.issues ? err.data.issues.map((i) => `${i.field}: ${i.message}`).join(" · ") : err.message;
      btn.disabled = false;
    }
  });
}

// ───────────────────────── Event list ─────────────────────────
async function renderEvents() {
  const events = await api("/api/events");
  $app.innerHTML = `<h1 style="margin-bottom:16px">My events</h1>` + (events.length ? `<div class="list">${events.map((e) => `
    <a class="item" href="#/event/${esc(e.id)}" style="text-decoration:none">
      <div class="top"><strong>${esc(e.title)}</strong>${pill(e.status)}</div>
      <div class="sub">${esc(e.date ?? "Date TBD")} · ${esc(e.city)}${e.pendingApprovals ? ` · <b style="color:var(--warn)">${e.pendingApprovals} awaiting your approval</b>` : ""}</div>
    </a>`).join("")}</div>` : `<div class="empty">No events yet. <a href="#/">Plan one →</a></div>`);
}

// ───────────────────────── Event dashboard ─────────────────────────
async function renderEvent(id) {
  const load = async () => {
    try { draw(await api(`/api/events/${id}`)); } catch (e) { $app.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
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

let reload = null;
let reloadPending = false;
document.addEventListener("focusout", () => {
  if (reloadPending && reload) { reloadPending = false; setTimeout(reload, 150); }
});

function draw(ev) {
  const bp = ev.blueprint;
  const cur = bp?.currency ?? ev.brief.currency ?? "USD";
  const done = ev.tasks.filter((t) => t.status === "done").length;
  const pendingApprovals = ev.approvals.filter((a) => a.status === "pending");
  const committed = ev.budget.reduce((s, b) => s + b.committed, 0);

  if (!bp) {
    $app.innerHTML = `<div class="card"><h3>${pill(ev.status)} Your Event Director is reading your vision…</h3><p class="sub">${esc(ev.brief.vision)}</p>${ev.error ? `<p class="error">${esc(ev.error)}</p>` : ""}</div>`;
    return;
  }

  const tabs = [
    ["overview", "Overview"], ["approvals", "Approvals", pendingApprovals.length], ["team", "AI Team"], ["tasks", "Tasks"],
    ["comms", "Messages"], ["vendors", "Vendors & Quotes"], ["budget", "Budget"], ["timeline", "Timeline"],
    ["marketing", "Marketing"], ["risks", "Risks"], ["activity", "Activity"],
  ];
  const body = {
    overview: overview, approvals: approvals, team: team, tasks: tasks, comms: commsTab, vendors: vendors,
    budget: budget, timeline: timeline, marketing: marketing, risks: risks, activity: activity,
  }[currentTab](ev, cur);

  $app.innerHTML = `
    <div class="event-head">
      <div>
        <div class="meta">${label(bp.eventType)} · ${esc(bp.date ?? "Date TBD")} · ${esc(bp.city)} · ${esc(bp.guestCount)} guests</div>
        <h1>${esc(bp.title)}</h1>
      </div>
      <div class="actions">
        ${pill(ev.status)}
        ${ev.status === "paused" ? `<button class="btn small" data-act="resume">Resume agents</button>` : ev.status === "completed" ? "" : `<button class="btn ghost small" data-act="pause">Pause agents</button>`}
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="v">${ev.roster.length}</div><div class="l">AI agents on your team</div></div>
      <div class="stat"><div class="v">${done}/${ev.tasks.length}</div><div class="l">Tasks complete</div><div class="progress"><i style="width:${(done / Math.max(1, ev.tasks.length)) * 100}%"></i></div></div>
      <div class="stat"><div class="v">${pendingApprovals.length}</div><div class="l">Waiting on you</div></div>
      <div class="stat"><div class="v">${ev.communications.filter((c) => c.direction === "outbound").length}</div><div class="l">Messages & calls sent</div></div>
      <div class="stat"><div class="v">${money(committed, cur)}</div><div class="l">Committed of ${money(bp.budget, cur)}</div><div class="progress"><i style="width:${Math.min(100, (committed / Math.max(1, bp.budget)) * 100)}%"></i></div></div>
    </div>
    <div class="tabs">${tabs.map(([k, l, n]) => `<button data-tab="${k}" class="${k === currentTab ? "active" : ""}">${l}${n ? `<span class="count">${n}</span>` : ""}</button>`).join("")}</div>
    <div>${body}</div>`;

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

function overview(ev, cur) {
  const bp = ev.blueprint;
  const list = (xs) => xs?.length ? `<ul style="padding-left:18px">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<span class="sub">—</span>`;
  const next = ev.tasks.filter((t) => !["done", "skipped"].includes(t.status)).sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9")).slice(0, 6);
  return `
    <div class="grid2">
      <div class="card"><h3>Blueprint</h3><p>${esc(bp.summary)}</p>
        <p class="sub" style="margin-top:8px"><b>Theme:</b> ${esc(bp.theme)} · <b>Audience:</b> ${esc(bp.audience)} · ${bp.ticketed ? "Ticketed" : "Invite-only"} · ${esc(bp.durationHours)}h</p>
        <h3 style="margin-top:14px">Goals</h3>${list(bp.goals)}
        <h3 style="margin-top:14px">Guest journey</h3>${list(bp.experienceMoments)}
      </div>
      <div class="list">
        <div class="card"><h3>Questions for you</h3>${list(bp.openQuestions)}</div>
        <div class="card"><h3>Constraints we're honoring</h3>${list(bp.constraints)}</div>
        <div class="card"><h3>Up next</h3>${next.map((t) => `<div class="item" style="margin-bottom:6px"><div class="top"><span>${esc(t.title)}</span>${pill(t.status)}</div><div class="sub">${label(t.roleId)} · due ${esc(t.dueDate ?? "—")}</div></div>`).join("") || `<span class="sub">All done 🎉</span>`}</div>
      </div>
    </div>`;
}

function approvals(ev, cur) {
  const pending = ev.approvals.filter((a) => a.status === "pending");
  const decided = ev.approvals.filter((a) => a.status !== "pending").reverse();
  const card = (a) => `
    <div class="item approval">
      <div class="top"><strong>${esc(a.title)}</strong>${pill(a.status)}</div>
      <div class="sub">${label(a.kind)} · requested by ${label(a.roleId)}${a.amount ? ` · <b>${money(a.amount, cur)}</b>` : ""}</div>
      <pre>${esc(a.details)}</pre>
      ${a.options?.length ? `<div class="sub">Options: ${a.options.map(esc).join(" / ")}</div>` : ""}
      ${a.status === "pending" ? `<textarea id="note-${esc(a.id)}" placeholder="Optional note to the agent (e.g. 'negotiate 10% lower' or 'go with option B')"></textarea>
        <div class="btns"><button class="btn ok small" data-decide="${esc(a.id)}:yes">Approve</button><button class="btn bad small" data-decide="${esc(a.id)}:no">Decline</button></div>`
        : a.decisionNote ? `<div class="sub">Note: ${esc(a.decisionNote)}</div>` : ""}
    </div>`;
  return `<div class="list">${pending.map(card).join("") || `<div class="empty">Nothing needs your approval right now. Your agents will ask before anything is booked, paid, signed or published.</div>`}</div>
    ${decided.length ? `<h3 style="margin:24px 0 10px">History</h3><div class="list">${decided.map(card).join("")}</div>` : ""}`;
}

function team(ev) {
  const depts = [...new Set(ev.roster.map((a) => a.department))];
  return `<div class="team">${depts.map((d) => `<div class="dept">${esc(d)}</div>` + ev.roster.filter((a) => a.department === d).map((a) => {
    const ts = ev.tasks.filter((t) => t.roleId === a.roleId);
    return `<div class="item"><div class="top"><strong>${esc(a.title)}</strong>${pill(a.status)}</div>
      <div class="sub" style="margin:4px 0">${esc(a.mission)}</div>
      <div class="sub">Why: ${esc(a.reason)} · ${ts.filter((t) => t.status === "done").length}/${ts.length} tasks</div></div>`;
  }).join("")).join("")}</div>`;
}

function tasks(ev) {
  return `<div class="board">${PHASES.map((p) => {
    const ts = ev.tasks.filter((t) => t.phase === p);
    return `<div class="col"><h4>${label(p)} (${ts.filter((t) => t.status === "done").length}/${ts.length})</h4>${ts.map((t) => `
      <div class="item"><div class="top"><span>${esc(t.title)}</span>${pill(t.status)}</div>
      <div class="sub">${label(t.roleId)} · due ${esc(t.dueDate ?? "—")}</div>
      ${t.output ? `<pre>${esc(t.output)}</pre>` : ""}
      ${t.status === "blocked" || t.status === "waiting_vendor" ? `<button class="btn ghost small" style="margin-top:6px" data-retry="${esc(t.id)}">Retry</button>` : ""}
      </div>`).join("")}</div>`;
  }).join("")}</div>`;
}

function commsTab(ev) {
  const vname = (id) => ev.vendors.find((v) => v.id === id)?.name;
  const msgs = [...ev.communications].reverse();
  return msgs.length ? `<div class="list">${msgs.map((c) => `
    <div class="item"><div class="top"><span>${c.direction === "outbound" ? "→" : "←"} <b>${esc(c.channel.toUpperCase())}</b> ${c.direction === "outbound" ? "to" : "from"} ${esc(vname(c.vendorId) ?? c.to ?? c.from ?? "")}</span>${pill(c.status)}</div>
      <div class="sub">${label(c.roleId)} · ${new Date(c.createdAt).toLocaleString()}</div>
      ${c.subject ? `<div style="margin-top:6px"><b>${esc(c.subject)}</b></div>` : ""}<pre>${esc(c.body)}</pre></div>`).join("")}</div>`
    : `<div class="empty">No messages yet.</div>`;
}

function vendors(ev, cur) {
  const quoteFor = (v) => ev.quotes.filter((q) => q.vendorId === v.id);
  const rows = ev.vendors.map((v) => {
    const qs = quoteFor(v);
    return `<tr><td><b>${esc(v.name)}</b><div class="sub">${esc(v.website ?? "")}</div></td><td>${esc(v.category)}</td><td>${esc(v.rating ?? "—")}</td>
      <td>${qs.map((q) => `${money(q.amount, q.currency)} ${pill(q.status)}`).join("<br>") || "—"}</td><td>${v.doNotContact ? pill("blocked") : esc(v.source)}</td></tr>`;
  }).join("");
  return ev.vendors.length ? `<div class="card" style="overflow-x:auto"><table><thead><tr><th>Vendor</th><th>Category</th><th>Rating</th><th>Quotes</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">Agents haven't searched for vendors yet.</div>`;
}

function budget(ev, cur) {
  const total = ev.blueprint.budget;
  const sum = (k) => ev.budget.reduce((s, b) => s + (b[k] || 0), 0);
  return `<div class="card" style="overflow-x:auto"><table><thead><tr><th>Category</th><th>Notes</th><th class="num">Planned</th><th class="num">Committed</th><th class="num">Paid</th></tr></thead><tbody>
    ${ev.budget.map((b) => `<tr><td>${esc(b.category)}</td><td class="sub">${esc(b.description)}</td><td class="num">${money(b.estimated, cur)}</td><td class="num" style="${b.committed > b.estimated ? "color:var(--bad)" : ""}">${money(b.committed, cur)}</td><td class="num">${money(b.paid, cur)}</td></tr>`).join("")}
    <tr><th>Total</th><th class="sub">Budget ${money(total, cur)}</th><th class="num">${money(sum("estimated"), cur)}</th><th class="num">${money(sum("committed"), cur)}</th><th class="num">${money(sum("paid"), cur)}</th></tr>
  </tbody></table></div>`;
}

function timeline(ev) {
  const block = (kind, title) => {
    const items = ev.timeline.filter((t) => t.kind === kind);
    return `<div class="card"><h3>${title}</h3>${items.length ? items.map((t) => `<div class="item" style="margin-bottom:6px"><div class="top"><b>${esc(t.when)}</b><span class="sub">${label(t.owner)}</span></div><div>${esc(t.title)}</div>${t.notes ? `<div class="sub">${esc(t.notes)}</div>` : ""}</div>`).join("") : `<div class="sub">Not built yet.</div>`}</div>`;
  };
  return `<div class="grid2">${block("milestone", "Planning milestones")}${block("run_of_show", "Run of show (event day)")}</div>`;
}

function marketing(ev) {
  return ev.marketing.length ? `<div class="list">${ev.marketing.map((m) => `<div class="item"><div class="top"><strong>${esc(m.title)}</strong>${pill(m.status)}</div><div class="sub">${label(m.kind)} · ${esc(m.channel)}${m.scheduledFor ? ` · ${esc(m.scheduledFor)}` : ""}</div><pre>${esc(m.content)}</pre></div>`).join("")}</div>` : `<div class="empty">No marketing or guest communications drafted yet.</div>`;
}

function risks(ev) {
  return ev.risks.length ? `<div class="list">${ev.risks.map((r) => `<div class="item"><div class="top"><strong>${esc(r.description)}</strong><span>${pill(r.likelihood)} ${pill(r.impact)}</span></div><div class="sub">${label(r.roleId)}</div><pre>Mitigation: ${esc(r.mitigation)}</pre></div>`).join("")}</div>` : `<div class="empty">No risks logged yet.</div>`;
}

function activity(ev) {
  const items = [...ev.activity].reverse().slice(0, 300);
  return `<div class="list feed">${items.map((a) => `<div class="item"><span class="time">${new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><span class="who">${label(a.roleId)}</span><span>${esc(a.text)}</span></div>`).join("") || `<div class="empty">No activity yet.</div>`}</div>`;
}
