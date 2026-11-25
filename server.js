import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, checkPin, hashPin, niceScore, verdict, normalizePhone } from "./lib/store.js";
import { replyToKid, replyToParent, aiEnabled, daysUntilChristmas } from "./lib/santa.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ store, twilioAuthToken = process.env.TWILIO_AUTH_TOKEN, publicUrl = process.env.PUBLIC_URL } = {}) {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "32kb" }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));
  app.use(express.static(path.join(here, "public")));

  // ---- grown-up sessions (in memory; restart = log in again) ----
  const sessions = new Map(); // token -> expiry
  const SESSION_MS = 12 * 60 * 60 * 1000;
  const loginAttempts = new Map(); // ip -> { count, until }

  function token(req) {
    const m = (req.headers.cookie || "").match(/(?:^|;\s*)santa_parent=([a-f0-9]+)/);
    return m?.[1];
  }
  function isParent(req) {
    const t = token(req);
    const exp = t && sessions.get(t);
    if (!exp || exp < Date.now()) return false;
    return true;
  }
  function requireParent(req, res, next) {
    if (!isParent(req)) return res.status(401).json({ error: "Grown-ups only! Please enter your PIN." });
    next();
  }
  function startSession(res) {
    const t = crypto.randomBytes(24).toString("hex");
    sessions.set(t, Date.now() + SESSION_MS);
    res.setHeader("Set-Cookie", `santa_parent=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
  }

  const publicChild = (c) => ({ id: c.id, name: c.name });
  const fullChild = (c) => ({
    ...c,
    niceScore: niceScore(c),
    verdict: verdict(c),
    messages: store.conversation(`kid:${c.id}`),
  });

  // ---- shared ----
  app.get("/api/state", (req, res) => {
    res.json({
      setup: store.data.setup,
      children: store.data.children.map(publicChild),
      ai: aiEnabled(),
      daysUntilChristmas: daysUntilChristmas(),
      parent: isParent(req),
    });
  });

  app.post("/api/setup", (req, res) => {
    if (store.data.setup) return res.status(409).json({ error: "Already set up. Log in as a grown-up to make changes." });
    const { pin, children = [], parentPhones = [] } = req.body || {};
    if (!/^\d{4,8}$/.test(String(pin || ""))) return res.status(400).json({ error: "PIN must be 4-8 digits." });
    const kids = children.filter((c) => c && String(c.name || "").trim());
    if (!kids.length) return res.status(400).json({ error: "Add at least one child." });
    store.setup({ pin, children: kids, parentPhones });
    startSession(res);
    res.json({ ok: true });
  });

  // ---- grown-ups ----
  app.post("/api/parent/login", (req, res) => {
    const ip = req.ip;
    const a = loginAttempts.get(ip) || { count: 0, until: 0 };
    if (a.until > Date.now()) return res.status(429).json({ error: "Too many tries. Wait a minute and try again." });
    if (!checkPin(String(req.body?.pin || ""), store.data.parentPinHash)) {
      a.count += 1;
      if (a.count >= 5) Object.assign(a, { count: 0, until: Date.now() + 60_000 });
      loginAttempts.set(ip, a);
      return res.status(401).json({ error: "That PIN isn't right." });
    }
    loginAttempts.delete(ip);
    startSession(res);
    res.json({ ok: true });
  });

  app.post("/api/parent/logout", (req, res) => {
    sessions.delete(token(req));
    res.setHeader("Set-Cookie", "santa_parent=; Path=/; Max-Age=0");
    res.json({ ok: true });
  });

  app.get("/api/parent/dashboard", requireParent, (req, res) => {
    res.json({
      children: store.data.children.map(fullChild),
      parentPhones: store.data.parentPhones,
      messages: store.conversation("parent"),
      smsWebhook: publicUrl ? `${publicUrl.replace(/\/$/, "")}/sms` : null,
    });
  });

  app.post("/api/parent/messages", requireParent, async (req, res) => {
    const text = String(req.body?.text || "").trim().slice(0, 1000);
    if (!text) return res.status(400).json({ error: "Say something to Santa!" });
    res.json(await handleParentText(text));
  });

  app.post("/api/parent/children", requireParent, (req, res) => {
    const { name, age, phone } = req.body || {};
    if (!String(name || "").trim()) return res.status(400).json({ error: "Name required." });
    res.json(publicChild(store.addChild({ name, age, phone })));
  });
  app.delete("/api/parent/children/:id", requireParent, (req, res) => {
    store.removeChild(req.params.id);
    res.json({ ok: true });
  });
  app.post("/api/parent/children/:id/reports", requireParent, (req, res) => {
    const { kind, note } = req.body || {};
    store.addReport(req.params.id, kind, note || (kind === "nice" ? "Nice!" : "Naughty"));
    res.json({ ok: true });
  });
  app.delete("/api/parent/children/:id/reports/:rid", requireParent, (req, res) => {
    store.removeReport(req.params.id, req.params.rid);
    res.json({ ok: true });
  });
  app.post("/api/parent/children/:id/wishes", requireParent, (req, res) => {
    store.addWish(req.params.id, req.body?.item || "");
    res.json({ ok: true });
  });
  app.delete("/api/parent/children/:id/wishes/:wid", requireParent, (req, res) => {
    store.removeWish(req.params.id, req.params.wid);
    res.json({ ok: true });
  });
  app.put("/api/parent/settings", requireParent, (req, res) => {
    const { pin, parentPhones, childPhones } = req.body || {};
    if (pin !== undefined) {
      if (!/^\d{4,8}$/.test(String(pin))) return res.status(400).json({ error: "PIN must be 4-8 digits." });
      store.data.parentPinHash = hashPin(pin);
    }
    if (Array.isArray(parentPhones)) store.data.parentPhones = parentPhones.map(normalizePhone).filter(Boolean);
    if (childPhones && typeof childPhones === "object") {
      for (const [id, phone] of Object.entries(childPhones)) {
        const c = store.child(id);
        if (c) c.phone = normalizePhone(phone);
      }
    }
    store.save();
    res.json({ ok: true });
  });

  // ---- kids ----
  app.get("/api/kid/:id/messages", (req, res) => {
    const child = store.child(req.params.id);
    if (!child) return res.status(404).json({ error: "Santa can't find that name!" });
    res.json({ child: publicChild(child), messages: store.conversation(`kid:${child.id}`) });
  });

  app.post("/api/kid/:id/messages", async (req, res) => {
    const child = store.child(req.params.id);
    if (!child) return res.status(404).json({ error: "Santa can't find that name!" });
    const text = String(req.body?.text || "").trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: "Type a message to Santa!" });
    res.json(await handleKidText(child, text));
  });

  async function handleKidText(child, text) {
    const key = `kid:${child.id}`;
    store.appendMessage(key, "user", text);
    const { reply, newWishes } = await replyToKid(child, store.conversation(key));
    for (const w of newWishes) store.addWish(child.id, w);
    store.appendMessage(key, "santa", reply);
    return { reply, wishes: child.wishes.map((w) => w.item) };
  }

  async function handleParentText(text) {
    store.appendMessage("parent", "user", text);
    const { reply, reports, wishes } = await replyToParent(
      store.data.children,
      store.conversation("parent"),
      (name) => store.childByName(name),
    );
    for (const r of reports) store.addReport(r.child.id, r.kind, r.note);
    for (const w of wishes) store.addWish(w.child.id, w.item);
    store.appendMessage("parent", "santa", reply);
    return {
      reply,
      recorded: {
        reports: reports.map((r) => ({ child: r.child.name, kind: r.kind, note: r.note })),
        wishes: wishes.map((w) => ({ child: w.child.name, item: w.item })),
      },
    };
  }

  // ---- real SMS via Twilio (optional) ----
  app.post("/sms", async (req, res) => {
    if (twilioAuthToken && !validTwilioSignature(req, twilioAuthToken, publicUrl)) {
      return res.status(403).send("Bad signature");
    }
    const from = req.body?.From;
    const body = String(req.body?.Body || "").trim().slice(0, 1000);
    const who = store.identifyPhone(from);
    let reply;
    if (!store.data.setup || !who) {
      reply = "Ho ho ho! Santa doesn't recognize this number yet. Ask a grown-up to add it on the Santa app's grown-ups page. 🎅";
    } else if (!body) {
      reply = "Ho ho ho! Did you mean to send Santa a message? 🎄";
    } else if (who.role === "parent") {
      reply = (await handleParentText(body)).reply;
    } else {
      reply = (await handleKidText(who.child, body)).reply;
    }
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(reply)}</Message></Response>`);
  });

  return app;
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);
}

// https://www.twilio.com/docs/usage/webhooks/webhooks-security
function validTwilioSignature(req, authToken, publicUrl) {
  const sig = req.headers["x-twilio-signature"];
  if (!sig) return false;
  const url = publicUrl ? `${publicUrl.replace(/\/$/, "")}${req.originalUrl}` : `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const params = req.body || {};
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac("sha1", authToken).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = new Store(process.env.DATA_FILE || path.join(here, "data", "santa.json"));
  const port = Number(process.env.PORT) || 3000;
  createApp({ store }).listen(port, () => {
    console.log(`🎅 Santa is listening on http://localhost:${port}`);
    console.log(aiEnabled() ? `   Using Claude for Santa's replies.` : "   No ANTHROPIC_API_KEY set: using Santa's built-in offline replies.");
  });
}
