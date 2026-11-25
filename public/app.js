// Text Santa — front end (no build step).
const app = document.getElementById("app");

// ---------- tiny helpers ----------
function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid.nodeType ? kid : String(kid));
  return node;
}
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong"), { status: res.status });
  return data;
}
const go = (hash) => (location.hash = hash);
const when = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const render = (...nodes) => app.replaceChildren(...nodes);

let state = null;
async function loadState() {
  state = await api("GET", "/api/state");
  return state;
}

// ---------- router ----------
async function route() {
  await loadState();
  const [, page, id] = location.hash.replace(/^#/, "").split("/");
  if (!state.setup && page !== "setup") return go("#/setup");
  try {
    if (page === "setup") return setupView();
    if (page === "kid" && id) return kidChatView(id);
    if (page === "parent" && id === "chat") return state.parent ? parentChatView() : loginView("#/parent/chat");
    if (page === "parent") return state.parent ? dashboardView() : loginView("#/parent");
    homeView();
  } catch (err) {
    render(el("p", { class: "error" }, err.message));
  }
}
window.addEventListener("hashchange", route);
route();

// ---------- views ----------
function countdown() {
  const d = state.daysUntilChristmas;
  return el("div", { class: "countdown" }, d === 0 ? "🎄 It's Christmas! 🎄" : `🎄 ${d} day${d === 1 ? "" : "s"} until Christmas`);
}

function homeView() {
  render(
    el("section", { class: "hero" },
      el("span", { class: "santa", "aria-hidden": "true" }, "🎅"),
      el("h1", {}, "Text Santa!"),
      el("p", { class: "muted" }, "Tell Santa what you want for Christmas."),
      countdown(),
    ),
    el("div", { class: "card" },
      el("h2", {}, "Who's texting Santa?"),
      el("div", { class: "grid" },
        state.children.map((c, i) =>
          el("a", { class: "pick", href: `#/kid/${c.id}` }, el("span", { class: "emoji" }, ["🧒", "👧", "👦", "🧑", "👶"][i % 5]), c.name)),
        el("a", { class: "pick", href: "#/parent" }, el("span", { class: "emoji" }, "🧑‍🎄"), "Grown-up"),
      ),
    ),
    el("p", { class: "center muted small" },
      state.ai ? "Santa's replies are powered by Claude." : "Santa is in offline mode (no API key set) — he still replies!"),
  );
}

function setupView() {
  if (state.setup) return go("#/");
  const kidsBox = el("div");
  const addKidRow = () =>
    kidsBox.append(
      el("div", { class: "row", style: "margin-bottom:8px" },
        el("input", { placeholder: "Child's first name", name: "kname", "aria-label": "Child's first name" }),
        el("input", { placeholder: "Age", name: "kage", type: "number", min: 1, max: 17, style: "max-width:90px", "aria-label": "Age" }),
        el("input", { placeholder: "Phone (optional, for SMS)", name: "kphone", type: "tel", "aria-label": "Child phone" }),
      ),
    );
  addKidRow();
  const err = el("p", { class: "error" });
  const form = el("form", {
    class: "card",
    async onsubmit(e) {
      e.preventDefault();
      const f = new FormData(form);
      const names = f.getAll("kname"), ages = f.getAll("kage"), phones = f.getAll("kphone");
      const children = names.map((name, i) => ({ name, age: ages[i], phone: phones[i] })).filter((c) => c.name.trim());
      if (f.get("pin") !== f.get("pin2")) return (err.textContent = "PINs don't match.");
      try {
        await api("POST", "/api/setup", {
          pin: f.get("pin"),
          children,
          parentPhones: String(f.get("pphones") || "").split(",").map((s) => s.trim()).filter(Boolean),
        });
        go("#/parent");
      } catch (e2) {
        err.textContent = e2.message;
      }
    },
  },
    el("h2", {}, "Welcome to the North Pole! 🎄"),
    el("p", { class: "muted" }, "Grown-ups: set up your family. Your PIN keeps naughty-or-nice reports and the dashboard private from the kids."),
    el("label", {}, "Your children"),
    kidsBox,
    el("button", { type: "button", class: "secondary", onclick: addKidRow }, "+ Add another child"),
    el("div", { class: "row" },
      el("div", {}, el("label", { for: "pin" }, "Grown-up PIN (4-8 digits)"), el("input", { id: "pin", name: "pin", type: "password", inputmode: "numeric", pattern: "\\d{4,8}", required: true })),
      el("div", {}, el("label", { for: "pin2" }, "Confirm PIN"), el("input", { id: "pin2", name: "pin2", type: "password", inputmode: "numeric", pattern: "\\d{4,8}", required: true })),
    ),
    el("label", { for: "pphones" }, "Grown-up phone numbers (optional, comma separated, for real SMS)"),
    el("input", { id: "pphones", name: "pphones", type: "tel", placeholder: "+15551234567" }),
    err,
    el("button", { type: "submit" }, "Start texting Santa 🎅"),
  );
  render(el("section", { class: "hero" }, el("span", { class: "santa" }, "🎅"), el("h1", {}, "Text Santa")), form);
}

function loginView(next) {
  const err = el("p", { class: "error" });
  const input = el("input", { type: "password", inputmode: "numeric", autocomplete: "current-password", placeholder: "PIN", "aria-label": "PIN", required: true });
  const form = el("form", {
    class: "card",
    async onsubmit(e) {
      e.preventDefault();
      try {
        await api("POST", "/api/parent/login", { pin: input.value });
        route();
      } catch (e2) {
        err.textContent = e2.message;
        input.value = "";
      }
    },
  },
    el("h2", {}, "🔒 Grown-ups only"),
    el("p", { class: "muted" }, "Enter your PIN to report naughty or nice and see wish lists."),
    el("div", { class: "row" }, input, el("button", { class: "shrink", type: "submit" }, "Enter")),
    err,
  );
  render(el("p", {}, el("a", { href: "#/", class: "btn secondary" }, "← Back")), form);
  input.focus();
}

// ---------- chat ----------
function chatShell({ title, subtitle, back, messages, placeholder, chips = [], onSend, extraHeader }) {
  const list = el("div", { class: "messages", role: "log" });
  const add = (from, text) => {
    list.append(el("div", { class: `bubble ${from === "santa" ? "santa" : from === "note" ? "note" : "me"}` }, text));
    list.scrollTop = list.scrollHeight;
  };
  messages.forEach((m) => add(m.from, m.text));
  const input = el("input", { placeholder, "aria-label": "Message", autocomplete: "off", maxlength: 1000 });
  const sendBtn = el("button", { type: "submit", "aria-label": "Send" }, "Send");
  let busy = false;
  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = "";
    add("me", text);
    const typing = el("div", { class: "typing", "aria-label": "Santa is typing" }, el("i"), el("i"), el("i"));
    list.append(typing);
    list.scrollTop = list.scrollHeight;
    try {
      await onSend(text, add);
    } catch (e) {
      add("note", e.message);
    } finally {
      typing.remove();
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }
  const phone = el("section", { class: "phone" },
    el("header", {},
      el("a", { href: back, class: "btn secondary", "aria-label": "Back" }, "←"),
      el("span", { class: "avatar", "aria-hidden": "true" }, "🎅"),
      el("div", { class: "who" }, el("b", {}, title), el("span", {}, subtitle)),
      extraHeader,
    ),
    list,
    chips.length ? el("div", { class: "chips" }, chips.map((c) => el("button", { type: "button", class: "chip", onclick: () => send(c) }, c))) : null,
    el("form", { class: "composer", onsubmit: (e) => (e.preventDefault(), send(input.value)) }, input, sendBtn),
  );
  render(phone);
  input.focus();
}

async function kidChatView(id) {
  const { child, messages } = await api("GET", `/api/kid/${id}/messages`);
  const intro = messages.length ? [] : [{ from: "santa", text: `Ho ho ho! Hi ${child.name}! 🎅 It's Santa! What would you like for Christmas this year?` }];
  chatShell({
    title: "Santa Claus",
    subtitle: "● North Pole",
    back: "#/",
    messages: [...messages, ...intro],
    placeholder: `Text Santa, ${child.name}…`,
    chips: ["Hi Santa! 👋", "For Christmas I want…", "I was nice today!", "How are the reindeer? 🦌"],
    async onSend(text, add) {
      if (text.endsWith("…")) return add("note", "Finish your message in the box below! ✏️");
      const { reply } = await api("POST", `/api/kid/${id}/messages`, { text });
      add("santa", reply);
    },
  });
}

async function parentChatView() {
  const data = await api("GET", "/api/parent/dashboard");
  const names = data.children.map((c) => c.name);
  chatShell({
    title: "Santa (grown-ups line)",
    subtitle: "● Private — kids can't see this",
    back: "#/parent",
    messages: data.messages.length
      ? data.messages
      : [{ from: "santa", text: `Ho ho ho! Thanks for helping me keep my list. How have ${names.join(" and ") || "the kids"} been? Tell me the naughty and the nice! 🎅📖` }],
    placeholder: "e.g. Mia shared her toys today",
    chips: names.slice(0, 3).flatMap((n) => [`${n} was really nice today`, `${n} was a little naughty today`]).slice(0, 4),
    async onSend(text, add) {
      const { reply, recorded } = await api("POST", "/api/parent/messages", { text });
      add("santa", reply);
      for (const r of recorded.reports) add("note", `📖 Recorded ${r.kind === "nice" ? "NICE ✅" : "NAUGHTY ⚠️"} for ${r.child}: ${r.note}`);
      for (const w of recorded.wishes) add("note", `🎁 Added "${w.item}" to ${w.child}'s wish list`);
    },
  });
}

// ---------- dashboard ----------
let dashTab = null;
async function dashboardView() {
  const data = await api("GET", "/api/parent/dashboard");
  const refresh = () => dashboardView();
  if (!dashTab || (dashTab !== "settings" && !data.children.some((c) => c.id === dashTab))) dashTab = data.children[0]?.id || "settings";

  const tabs = el("div", { class: "tabs", role: "tablist" },
    data.children.map((c) => el("button", { role: "tab", "aria-selected": String(dashTab === c.id), onclick: () => ((dashTab = c.id), refresh()) }, `${c.verdict.startsWith("Naughty") ? "⚠️" : "⭐"} ${c.name}`)),
    el("button", { role: "tab", "aria-selected": String(dashTab === "settings"), onclick: () => ((dashTab = "settings"), refresh()) }, "⚙️ Settings"),
  );

  const body = dashTab === "settings" ? settingsPanel(data, refresh) : kidPanel(data.children.find((c) => c.id === dashTab), refresh);

  render(
    el("div", { class: "topbar" },
      el("a", { href: "#/", class: "btn secondary" }, "← Home"),
      el("h1", {}, "📖 Santa's Book"),
      el("span", { class: "spacer" }),
      el("a", { href: "#/parent/chat", class: "btn green" }, "💬 Text Santa"),
      el("button", { class: "secondary", onclick: async () => (await api("POST", "/api/parent/logout"), go("#/")) }, "Lock"),
    ),
    countdown(),
    tabs,
    body,
  );
}

function kidPanel(child, refresh) {
  const color = child.niceScore >= 60 ? "var(--nice)" : child.niceScore >= 40 ? "var(--gold)" : "var(--naughty)";
  const noteInput = el("input", { placeholder: `What did ${child.name} do? (optional)`, "aria-label": "Behavior note" });
  const report = (kind) => async () => {
    await api("POST", `/api/parent/children/${child.id}/reports`, { kind, note: noteInput.value });
    refresh();
  };
  const wishInput = el("input", { placeholder: "Add a gift idea", "aria-label": "Gift idea" });

  return el("div", {},
    el("div", { class: "card" },
      el("div", { class: "kid-head" },
        el("h2", {}, child.name, child.age ? el("span", { class: "muted small" }, ` · age ${child.age}`) : null),
        el("span", { class: "badge", style: `background:${color}` }, child.verdict),
      ),
      el("div", { class: "meter", role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": child.niceScore, "aria-label": "Nice meter" },
        el("span", { class: "dot", style: `left:${child.niceScore}%` }, child.niceScore >= 60 ? "😇" : "😈")),
      el("div", { class: "meter-labels" }, el("span", {}, "Naughty"), el("span", {}, "Nice")),
      noteInput,
      el("div", { class: "quick" },
        el("button", { class: "green", onclick: report("nice") }, "😇 Nice"),
        el("button", { onclick: report("naughty") }, "😈 Naughty"),
      ),
    ),
    el("div", { class: "cols" },
      el("div", { class: "card" },
        el("h3", {}, `🎁 Wish list (${child.wishes.length})`),
        child.wishes.length
          ? el("ul", { class: "list" }, child.wishes.map((w) =>
              el("li", {}, el("span", { class: "txt" }, w.item), el("time", {}, when(w.at)),
                el("button", { class: "ghost", "aria-label": `Remove ${w.item}`, onclick: async () => (await api("DELETE", `/api/parent/children/${child.id}/wishes/${w.id}`), refresh()) }, "✕"))))
          : el("p", { class: "muted" }, `No wishes yet. When ${child.name} texts Santa, wishes show up here.`),
        el("form", { class: "row", onsubmit: async (e) => { e.preventDefault(); if (!wishInput.value.trim()) return; await api("POST", `/api/parent/children/${child.id}/wishes`, { item: wishInput.value }); refresh(); } },
          wishInput, el("button", { class: "shrink secondary", type: "submit" }, "Add")),
      ),
      el("div", { class: "card" },
        el("h3", {}, "📖 Naughty & nice log"),
        child.reports.length
          ? el("ul", { class: "list" }, [...child.reports].reverse().map((r) =>
              el("li", {}, el("span", {}, r.kind === "nice" ? "😇" : "😈"), el("span", { class: "txt" }, r.note), el("time", {}, when(r.at)),
                el("button", { class: "ghost", "aria-label": "Remove report", onclick: async () => (await api("DELETE", `/api/parent/children/${child.id}/reports/${r.id}`), refresh()) }, "✕"))))
          : el("p", { class: "muted" }, "No reports yet. Use the buttons above or text Santa on the grown-ups line."),
      ),
    ),
    el("div", { class: "card" },
      el("details", {},
        el("summary", {}, `💬 ${child.name}'s chat with Santa (${child.messages.length} messages)`),
        el("div", { class: "transcript" },
          child.messages.length ? child.messages.map((m) => el("div", { class: `bubble ${m.from === "santa" ? "santa" : "me"}` }, m.text)) : el("p", { class: "muted" }, "No messages yet.")),
      ),
    ),
  );
}

function settingsPanel(data, refresh) {
  const msg = el("p", { class: "error" });
  const addForm = el("form", {
    class: "card",
    async onsubmit(e) {
      e.preventDefault();
      const f = new FormData(addForm);
      try {
        const kid = await api("POST", "/api/parent/children", { name: f.get("name"), age: f.get("age"), phone: f.get("phone") });
        dashTab = kid.id;
        refresh();
      } catch (e2) { msg.textContent = e2.message; }
    },
  },
    el("h3", {}, "Add a child"),
    el("div", { class: "row" },
      el("input", { name: "name", placeholder: "First name", required: true, "aria-label": "First name" }),
      el("input", { name: "age", type: "number", min: 1, max: 17, placeholder: "Age", style: "max-width:90px", "aria-label": "Age" }),
      el("input", { name: "phone", type: "tel", placeholder: "Phone (optional)", "aria-label": "Phone" }),
      el("button", { class: "shrink", type: "submit" }, "Add"),
    ),
  );

  const phonesForm = el("form", {
    class: "card",
    async onsubmit(e) {
      e.preventDefault();
      const f = new FormData(phonesForm);
      const childPhones = Object.fromEntries(data.children.map((c) => [c.id, f.get(`phone-${c.id}`)]));
      const body = { parentPhones: String(f.get("parents")).split(",").map((s) => s.trim()).filter(Boolean), childPhones };
      if (f.get("pin")) body.pin = f.get("pin");
      try { await api("PUT", "/api/parent/settings", body); msg.textContent = "Saved! ✅"; setTimeout(refresh, 600); }
      catch (e2) { msg.textContent = e2.message; }
    },
  },
    el("h3", {}, "📱 Real text messages (SMS)"),
    el("p", { class: "muted small" },
      "Optional: connect a Twilio phone number so your family can text Santa from real phones. Set the number's incoming-message webhook to ",
      el("code", {}, data.smsWebhook || `${location.origin}/sms`), ". Texts from a grown-up's number go to the private grown-ups line; texts from a child's number go to that child's chat."),
    el("label", {}, "Grown-up numbers (comma separated)"),
    el("input", { name: "parents", type: "tel", value: data.parentPhones.join(", ") }),
    data.children.map((c) => [el("label", {}, `${c.name}'s number`), el("input", { name: `phone-${c.id}`, type: "tel", value: c.phone || "" })]),
    el("h3", { style: "margin-top:16px" }, "🔒 Change PIN"),
    el("input", { name: "pin", type: "password", inputmode: "numeric", pattern: "\\d{4,8}", placeholder: "New PIN (leave blank to keep)" }),
    el("p", {}, el("button", { type: "submit" }, "Save settings")),
  );

  const removeCard = el("div", { class: "card" },
    el("h3", {}, "Remove a child"),
    el("ul", { class: "list" }, data.children.map((c) =>
      el("li", {}, el("span", { class: "txt" }, c.name),
        el("button", { class: "secondary", onclick: async () => { if (confirm(`Remove ${c.name} and their wish list?`)) { await api("DELETE", `/api/parent/children/${c.id}`); refresh(); } } }, "Remove")))),
  );
  return el("div", {}, msg, addForm, phonesForm, data.children.length ? removeCard : null);
}
