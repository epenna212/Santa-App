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
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !["/api/login", "/api/unlock", "/api/logout"].includes(url)) { go("#/"); setTimeout(route); }
  if (data.needPin) { setTimeout(() => pinView(location.hash || "#/parent")); }
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
  try {
    if (!state.signedIn) {
      if (page === "signup") return signupView();
      if (page === "signin") return signinView();
      return welcomeView();
    }
    if (page === "kid" && id) return kidChatView(id);
    if (page === "parent" && id === "chat") return state.grownup ? parentChatView() : pinView("#/parent/chat");
    if (page === "parent") return state.grownup ? dashboardView() : pinView("#/parent");
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
function hero(sub) {
  return el("section", { class: "hero" },
    el("span", { class: "santa", "aria-hidden": "true" }, "🎅"),
    el("h1", {}, "Text Santa!"),
    sub ? el("p", { class: "muted" }, sub) : null,
    countdown());
}

function welcomeView() {
  render(
    hero("Kids text Santa their Christmas wishes. Grown-ups privately tell Santa who's been naughty or nice."),
    el("div", { class: "card center" },
      el("h2", {}, "Grown-ups, start here"),
      el("p", { class: "muted" }, "Create a free family account, add your kids, and hand them the phone."),
      el("p", { class: "row", style: "justify-content:center" },
        el("a", { class: "btn", href: "#/signup" }, "Create family account"),
        el("a", { class: "btn secondary", href: "#/signin" }, "Sign in"))),
  );
}

function signupView() {
  const kidsBox = el("div");
  const addKidRow = () =>
    kidsBox.append(
      el("div", { class: "row", style: "margin-bottom:8px" },
        el("input", { placeholder: "Child's first name", name: "kname", "aria-label": "Child's first name", maxlength: 40 }),
        el("input", { placeholder: "Age", name: "kage", type: "number", min: 1, max: 17, style: "max-width:90px", "aria-label": "Age" }),
      ),
    );
  addKidRow();
  const err = el("p", { class: "error" });
  const form = el("form", {
    class: "card",
    async onsubmit(e) {
      e.preventDefault();
      const f = new FormData(form);
      const names = f.getAll("kname"), ages = f.getAll("kage");
      const children = names.map((name, i) => ({ name, age: ages[i] })).filter((c) => c.name.trim());
      if (f.get("pin") !== f.get("pin2")) return (err.textContent = "The two PINs don't match. Type them again.");
      try {
        await api("POST", "/api/signup", {
          familyName: f.get("familyName"),
          email: f.get("email"),
          password: f.get("password"),
          pin: f.get("pin"),
          children,
        });
        go("#/parent");
      } catch (e2) {
        err.textContent = e2.message;
      }
    },
  },
    el("h2", {}, "Create your family account 🎄"),
    el("label", { for: "familyName" }, "Family name"),
    el("input", { id: "familyName", name: "familyName", placeholder: "The Garcia Family", maxlength: 60 }),
    el("label", { for: "email" }, "Grown-up's email (used to sign in)"),
    el("input", { id: "email", name: "email", type: "email", autocomplete: "email", required: true }),
    el("label", { for: "password" }, "Password (8+ characters)"),
    el("input", { id: "password", name: "password", type: "password", autocomplete: "new-password", minlength: 8, required: true }),
    el("label", {}, "Your children"),
    kidsBox,
    el("button", { type: "button", class: "secondary", onclick: addKidRow }, "+ Add another child"),
    el("p", { class: "muted small", style: "margin-top:14px" }, "Your PIN unlocks Santa's Book (wish lists and naughty-or-nice reports) so the kids can't peek."),
    el("div", { class: "row" },
      el("div", {}, el("label", { for: "pin" }, "Grown-up PIN (4-8 digits)"), el("input", { id: "pin", name: "pin", type: "password", inputmode: "numeric", pattern: "\\d{4,8}", required: true })),
      el("div", {}, el("label", { for: "pin2" }, "Type the PIN again"), el("input", { id: "pin2", name: "pin2", type: "password", inputmode: "numeric", pattern: "\\d{4,8}", required: true })),
    ),
    err,
    el("p", { class: "row" }, el("button", { type: "submit", class: "shrink" }, "Create account 🎅"), el("a", { href: "#/signin", class: "shrink muted" }, "I already have one")),
  );
  render(el("p", {}, el("a", { href: "#/", class: "btn secondary" }, "← Back")), form);
}

function signinView() {
  const err = el("p", { class: "error" });
  const form = el("form", {
    class: "card",
    async onsubmit(e) {
      e.preventDefault();
      const f = new FormData(form);
      try {
        await api("POST", "/api/login", { email: f.get("email"), password: f.get("password") });
        go("#/");
        route();
      } catch (e2) {
        err.textContent = e2.message;
      }
    },
  },
    el("h2", {}, "Sign in"),
    el("p", { class: "muted" }, "This device stays signed in, so the kids can text Santa any time."),
    el("label", { for: "email" }, "Email"),
    el("input", { id: "email", name: "email", type: "email", autocomplete: "email", required: true }),
    el("label", { for: "password" }, "Password"),
    el("input", { id: "password", name: "password", type: "password", autocomplete: "current-password", required: true }),
    err,
    el("p", { class: "row" }, el("button", { type: "submit", class: "shrink" }, "Sign in"), el("a", { href: "#/signup", class: "shrink muted" }, "Create a family account")),
  );
  render(el("p", {}, el("a", { href: "#/", class: "btn secondary" }, "← Back")), form);
}

function homeView() {
  render(
    hero(`Tell Santa what you want for Christmas!`),
    el("div", { class: "card" },
      el("h2", {}, "Who's texting Santa?"),
      el("div", { class: "grid" },
        state.children.map((c, i) =>
          el("a", { class: "pick", href: `#/kid/${c.id}` }, el("span", { class: "emoji" }, ["🧒", "👧", "👦", "🧑", "👶"][i % 5]), c.name)),
        el("a", { class: "pick", href: "#/parent" }, el("span", { class: "emoji" }, "🧑‍🎄"), "Grown-up"),
      ),
    ),
    el("p", { class: "center muted small" }, state.familyName ? `${state.familyName} · ` : "", "Santa replies right away, any time of day."),
  );
}

function pinView(next) {
  const err = el("p", { class: "error" });
  const input = el("input", { type: "password", inputmode: "numeric", autocomplete: "off", placeholder: "PIN", "aria-label": "PIN", required: true });
  const form = el("form", {
    class: "card",
    async onsubmit(e) {
      e.preventDefault();
      try {
        await api("POST", "/api/unlock", { pin: input.value });
        location.hash === next ? route() : go(next);
      } catch (e2) {
        err.textContent = e2.message;
        input.value = "";
      }
    },
  },
    el("h2", {}, "🔒 Grown-ups only"),
    el("p", { class: "muted" }, "Enter your PIN to open Santa's Book."),
    el("div", { class: "row" }, input, el("button", { class: "shrink", type: "submit" }, "Open")),
    err,
  );
  render(el("p", {}, el("a", { href: "#/", class: "btn secondary" }, "← Back")), form);
  input.focus();
}

// ---------- voice (talk-to-text and read-aloud) ----------
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const canSpeak = "speechSynthesis" in window;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
function speak(text) {
  if (!canSpeak) return;
  const clean = text.replace(/\p{Extended_Pictographic}|️|‍/gu, "").replace(/\s+/g, " ").trim();
  if (!clean) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 0.95;
    u.pitch = 0.8; // a little deeper, more Santa-like
    speechSynthesis.speak(u);
  } catch {}
}

// ---------- chat ----------
function chatShell({ title, subtitle, back, messages, placeholder, chips = [], onSend, extraHeader, voice = false }) {
  let readAloud = voice && canSpeak && store.get("santa_read_aloud") === "1";
  const list = el("div", { class: "messages", role: "log" });
  const add = (from, text, { fresh = false } = {}) => {
    const isSanta = from === "santa";
    const bubble = el("div", { class: `bubble ${isSanta ? "santa" : from === "note" ? "note" : "me"}` }, text);
    if (isSanta && voice && canSpeak) {
      bubble.classList.add("speakable");
      bubble.title = "Tap to hear Santa";
      bubble.addEventListener("click", () => speak(text));
    }
    list.append(bubble);
    list.scrollTop = list.scrollHeight;
    if (isSanta && fresh && readAloud) speak(text);
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
    if (micBtn) micBtn.disabled = true;
    input.value = "";
    add("me", text);
    const typing = el("div", { class: "typing", "aria-label": "Santa is typing" }, el("i"), el("i"), el("i"));
    list.append(typing);
    list.scrollTop = list.scrollHeight;
    try {
      await onSend(text, (from, t) => add(from, t, { fresh: true }));
    } catch (e) {
      add("note", e.message);
    } finally {
      typing.remove();
      busy = false;
      sendBtn.disabled = false;
      if (micBtn) micBtn.disabled = false;
      if (!voice) input.focus();
    }
  }

  // Talk-to-text: tap the mic, talk, and the message sends itself when you stop.
  let micBtn = null;
  if (voice && SpeechRec) {
    let rec = null;
    const stop = () => { if (rec) rec.stop(); };
    micBtn = el("button", {
      type: "button", class: "mic", "aria-label": "Talk to Santa", title: "Tap and talk",
      onclick() {
        if (rec) return stop();
        if (canSpeak) try { speechSynthesis.cancel(); } catch {}
        rec = new SpeechRec();
        rec.lang = navigator.language || "en-US";
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        let finalText = "";
        let heard = false;
        rec.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) finalText += r[0].transcript;
            else interim += r[0].transcript;
          }
          heard = true;
          input.value = (finalText + interim).trim();
        };
        rec.onerror = (e) => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed") add("note", "🎤 Ask a grown-up to let this page use the microphone.");
          else if (e.error === "no-speech") add("note", "🎤 Santa didn't hear anything. Tap the microphone and try again!");
          else if (e.error !== "aborted") add("note", "🎤 The microphone isn't working right now. You can type instead!");
        };
        rec.onend = () => {
          rec = null;
          micBtn.classList.remove("listening");
          micBtn.setAttribute("aria-label", "Talk to Santa");
          input.placeholder = placeholder;
          const text = (finalText || input.value).trim();
          if (heard && text) send(text);
        };
        try {
          rec.start();
          micBtn.classList.add("listening");
          micBtn.setAttribute("aria-label", "Stop listening");
          input.value = "";
          input.placeholder = "Listening… talk to Santa!";
        } catch {
          rec = null;
        }
      },
    }, "🎤");
  }

  // Read-aloud toggle for kids who are still learning to read.
  let speakerBtn = null;
  if (voice && canSpeak) {
    const paint = () => {
      speakerBtn.textContent = readAloud ? "🔊" : "🔈";
      speakerBtn.setAttribute("aria-pressed", String(readAloud));
      speakerBtn.setAttribute("aria-label", readAloud ? "Santa reads out loud: on" : "Santa reads out loud: off");
    };
    speakerBtn = el("button", {
      type: "button", class: "secondary speaker",
      onclick() {
        readAloud = !readAloud;
        store.set("santa_read_aloud", readAloud ? "1" : "0");
        paint();
        if (readAloud) speak("Ho ho ho! I'll read my messages out loud for you!");
        else try { speechSynthesis.cancel(); } catch {}
      },
    });
    paint();
  }

  const phone = el("section", { class: "phone" },
    el("header", {},
      el("a", { href: back, class: "btn secondary", "aria-label": "Back" }, "←"),
      el("span", { class: "avatar", "aria-hidden": "true" }, "🎅"),
      el("div", { class: "who" }, el("b", {}, title), el("span", {}, subtitle)),
      speakerBtn,
      extraHeader,
    ),
    list,
    chips.length ? el("div", { class: "chips" }, chips.map((c) => el("button", { type: "button", class: "chip", onclick: () => send(c) }, c))) : null,
    micBtn ? el("p", { class: "mic-hint" }, "Tap 🎤 and talk to Santa!") : null,
    el("form", { class: "composer", onsubmit: (e) => (e.preventDefault(), send(input.value)) }, micBtn, input, sendBtn),
  );
  render(phone);
  window.addEventListener("hashchange", () => { try { speechSynthesis.cancel(); } catch {} }, { once: true });
  if (!voice) input.focus();
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
    voice: true,
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
      el("button", { class: "secondary", onclick: async () => (await api("POST", "/api/lock"), go("#/")) }, "Lock"),
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
              el("li", { class: "wish" },
                el("div", { class: "wish-top" },
                  el("span", { class: "txt" }, w.item), el("time", {}, when(w.at)),
                  el("button", { class: "ghost", "aria-label": `Remove ${w.item}`, onclick: async () => (await api("DELETE", `/api/parent/children/${child.id}/wishes/${w.id}`), refresh()) }, "✕")),
                shopLinks(w.item))))
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

// Search links to stores, so grown-ups can compare prices on each wish.
const STORES = [
  { name: "Compare prices", url: (q) => `https://www.google.com/search?tbm=shop&q=${q}` },
  { name: "Amazon", url: (q) => `https://www.amazon.com/s?k=${q}` },
  { name: "Walmart", url: (q) => `https://www.walmart.com/search?q=${q}` },
  { name: "Target", url: (q) => `https://www.target.com/s?searchTerm=${q}` },
  { name: "eBay", url: (q) => `https://www.ebay.com/sch/i.html?_nkw=${q}` },
];
function shopLinks(item) {
  const q = encodeURIComponent(item);
  return el("div", { class: "shop", "aria-label": `Shop for ${item}` },
    el("span", { class: "shop-label" }, "🛒 Shop:"),
    STORES.map((s) => el("a", { href: s.url(q), target: "_blank", rel: "noopener noreferrer" }, s.name)));
}

function settingsPanel(data, refresh) {
  const msg = el("p", { class: "error", role: "status" });
  const say = (t) => { msg.textContent = t; msg.scrollIntoView({ block: "nearest" }); };

  const addForm = el("form", {
    class: "card",
    async onsubmit(e) {
      e.preventDefault();
      const f = new FormData(addForm);
      try {
        const kid = await api("POST", "/api/parent/children", { name: f.get("name"), age: f.get("age") });
        dashTab = kid.id;
        refresh();
      } catch (e2) { say(e2.message); }
    },
  },
    el("h3", {}, "Add a child"),
    el("div", { class: "row" },
      el("input", { name: "name", placeholder: "First name", required: true, "aria-label": "First name", maxlength: 40 }),
      el("input", { name: "age", type: "number", min: 1, max: 17, placeholder: "Age", style: "max-width:90px", "aria-label": "Age" }),
      el("button", { class: "shrink", type: "submit" }, "Add"),
    ),
  );

  const accountForm = el("form", {
    class: "card",
    async onsubmit(e) {
      e.preventDefault();
      const f = new FormData(accountForm);
      const body = { familyName: f.get("familyName"), pin: f.get("pin") };
      if (f.get("password")) Object.assign(body, { password: f.get("password"), currentPassword: f.get("currentPassword") });
      if (data.smsEnabled) {
        body.parentPhones = String(f.get("parents") || "").split(",").map((s) => s.trim()).filter(Boolean);
        body.childPhones = Object.fromEntries(data.children.map((c) => [c.id, f.get(`phone-${c.id}`)]));
      }
      try { await api("PUT", "/api/parent/settings", body); say("Saved ✅"); accountForm.querySelectorAll("input[type=password]").forEach((i) => (i.value = "")); }
      catch (e2) { say(e2.message); }
    },
  },
    el("h3", {}, "Family settings"),
    el("p", { class: "muted small" }, `Signed in as ${data.email}`),
    el("label", { for: "s-family" }, "Family name"),
    el("input", { id: "s-family", name: "familyName", value: data.familyName, maxlength: 60 }),
    el("label", { for: "s-pin" }, "New PIN (leave blank to keep)"),
    el("input", { id: "s-pin", name: "pin", type: "password", inputmode: "numeric", pattern: "\\d{4,8}", autocomplete: "off" }),
    el("label", { for: "s-cur" }, "Change password: current password"),
    el("input", { id: "s-cur", name: "currentPassword", type: "password", autocomplete: "current-password" }),
    el("label", { for: "s-new" }, "New password"),
    el("input", { id: "s-new", name: "password", type: "password", autocomplete: "new-password", minlength: 8 }),
    data.smsEnabled ? [
      el("h3", { style: "margin-top:16px" }, "📱 Text Santa from real phones"),
      el("p", { class: "muted small" }, data.smsNumber ? `Santa's phone number is ${data.smsNumber}. ` : "", "Add your family's phone numbers. Texts from a grown-up's number go to the private grown-ups line; texts from a child's number go to that child's chat."),
      el("label", { for: "s-parents" }, "Grown-up numbers (comma separated)"),
      el("input", { id: "s-parents", name: "parents", type: "tel", value: data.parentPhones.join(", ") }),
      data.children.map((c) => [el("label", { for: `s-ph-${c.id}` }, `${c.name}'s number`), el("input", { id: `s-ph-${c.id}`, name: `phone-${c.id}`, type: "tel", value: c.phone || "" })]),
    ] : null,
    el("p", {}, el("button", { type: "submit" }, "Save settings")),
  );

  const removeCard = el("div", { class: "card" },
    el("h3", {}, "Remove a child"),
    el("ul", { class: "list" }, data.children.map((c) => {
      const li = el("li", {}, el("span", { class: "txt" }, c.name));
      const btn = el("button", { class: "secondary", onclick: () => {
        btn.replaceWith(el("span", { class: "row shrink" },
          el("span", { class: "small" }, "Remove their wishes and chat too?"),
          el("button", { class: "shrink", onclick: async () => { await api("DELETE", `/api/parent/children/${c.id}`); refresh(); } }, "Yes, remove"),
          el("button", { class: "shrink secondary", onclick: refresh }, "Cancel")));
      } }, "Remove");
      li.append(btn);
      return li;
    })),
  );

  const delPw = el("input", { type: "password", placeholder: "Your password", "aria-label": "Password to confirm", autocomplete: "current-password" });
  const dangerCard = el("div", { class: "card" },
    el("h3", {}, "This device"),
    el("p", { class: "row" },
      el("button", { class: "secondary shrink", onclick: async () => { await api("POST", "/api/logout"); go("#/"); route(); } }, "Sign out of this device")),
    el("details", {},
      el("summary", {}, "Delete family account"),
      el("p", { class: "muted small" }, "This permanently deletes your children, wish lists, reports and chats."),
      el("div", { class: "row" }, delPw,
        el("button", { class: "shrink", onclick: async () => {
          try { await api("DELETE", "/api/parent/account", { password: delPw.value }); go("#/"); route(); }
          catch (e2) { say(e2.message); }
        } }, "Delete everything"))),
  );
  return el("div", {}, msg, addForm, accountForm, data.children.length ? removeCard : null, dangerCard);
}
