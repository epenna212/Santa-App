import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, checkSecret, hashSecret, niceScore, verdict, normalizePhone, normalizeEmail } from "./lib/store.js";
import { replyToKid, replyToParent, aiEnabled, daysUntilChristmas } from "./lib/santa.js";
import { MemoStore, elevenLabsTts, voiceEnabled } from "./lib/voice.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const DEVICE_MS = 365 * 24 * 60 * 60 * 1000; // a family stays signed in on a device for a year
const GROWNUP_MS = 2 * 60 * 60 * 1000; // the PIN unlock lasts 2 hours
const DEFAULT_DAILY_REPLIES = 300; // Santa replies per family per day (protects your API bill)
const DEFAULT_DAILY_MEMOS = 30; // new Santa voice memos per family per day (protects your ElevenLabs allowance)

export function createApp({
  store,
  twilioAuthToken = process.env.TWILIO_AUTH_TOKEN,
  publicUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL,
  dailyReplies = Number(process.env.DAILY_REPLIES_PER_FAMILY) || DEFAULT_DAILY_REPLIES,
  dailyMemos = Number(process.env.VOICE_MEMOS_PER_FAMILY) || DEFAULT_DAILY_MEMOS,
  memoDir = process.env.MEMO_DIR || (process.env.DATA_FILE ? path.join(path.dirname(process.env.DATA_FILE), "memos") : path.join(here, "data", "memos")),
  tts = voiceEnabled() ? elevenLabsTts : null,
} = {}) {
  const memos = new MemoStore(memoDir);
  const app = express();
  app.set("trust proxy", true);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.use("/sms", express.urlencoded({ extended: false, limit: "32kb" }));
  app.use(express.static(path.join(here, "public")));
  app.get("/healthz", (req, res) => res.send("ok"));

  // Only JSON may change data under /api (blocks cross-site form posts).
  app.use("/api", (req, res, next) => {
    if (req.method !== "GET" && !req.is("application/json")) return res.status(415).json({ error: "Send JSON." });
    next();
  });

  // ---------- sessions ----------
  const COOKIE = "santa_family";
  const token = (req) => (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]+)`))?.[1];
  const setCookie = (req, res, value, maxAgeMs) =>
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}${req.secure ? "; Secure" : ""}`,
    );

  function attach(req, res, next) {
    const s = store.session(token(req));
    req.sess = s;
    req.family = s ? store.family(s.familyId) : null;
    req.grownup = Boolean(s && s.grownUntil > Date.now());
    next();
  }
  app.use("/api", attach);
  const requireFamily = (req, res, next) =>
    req.family ? next() : res.status(401).json({ error: "Please sign in to your family account." });
  const requireGrownup = (req, res, next) =>
    !req.family
      ? res.status(401).json({ error: "Please sign in to your family account." })
      : req.grownup
        ? next()
        : res.status(403).json({ error: "Grown-ups only! Please enter your PIN.", needPin: true });

  // Simple in-memory limiter for guessing passwords and PINs.
  const attempts = new Map();
  function tooMany(key) {
    const a = attempts.get(key);
    return a && a.until > Date.now();
  }
  function failed(key) {
    const a = attempts.get(key) || { count: 0, until: 0 };
    a.count += 1;
    if (a.count >= 5) Object.assign(a, { count: 0, until: Date.now() + 5 * 60_000 });
    attempts.set(key, a);
  }

  const publicChild = (c) => ({ id: c.id, name: c.name });
  const fullChild = (family, c) => ({
    ...c,
    niceScore: niceScore(c),
    verdict: verdict(c),
    messages: store.conversation(family, `kid:${c.id}`),
  });

  // ---------- account ----------
  app.get("/api/state", (req, res) => {
    res.json({
      signedIn: Boolean(req.family),
      familyName: req.family?.name ?? null,
      children: req.family ? req.family.children.map(publicChild) : [],
      grownup: req.grownup,
      ai: aiEnabled(),
      voiceMemos: Boolean(tts),
      daysUntilChristmas: daysUntilChristmas(),
    });
  });

  app.post("/api/signup", (req, res) => {
    const { familyName, email, password, pin, children = [] } = req.body || {};
    const e = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return res.status(400).json({ error: "Enter a valid email address." });
    if (String(password || "").length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    if (!/^\d{4,8}$/.test(String(pin || ""))) return res.status(400).json({ error: "PIN must be 4-8 digits." });
    const kids = (Array.isArray(children) ? children : []).filter((c) => c && String(c.name || "").trim()).slice(0, 12);
    if (!kids.length) return res.status(400).json({ error: "Add at least one child." });
    if (store.familyByEmail(e)) return res.status(409).json({ error: "That email already has a family account. Try signing in." });
    const family = store.createFamily({ familyName, email: e, password, pin, children: kids.map(({ name, age }) => ({ name, age })) });
    const t = store.createSession(family.id, DEVICE_MS);
    store.session(t).grownUntil = Date.now() + GROWNUP_MS;
    setCookie(req, res, t, DEVICE_MS);
    res.json({ ok: true });
  });

  app.post("/api/login", (req, res) => {
    const e = normalizeEmail(req.body?.email);
    const key = `login:${req.ip}:${e}`;
    if (tooMany(key)) return res.status(429).json({ error: "Too many tries. Wait 5 minutes and try again." });
    const family = store.familyByEmail(e);
    if (!family || !checkSecret(String(req.body?.password || ""), family.passwordHash)) {
      failed(key);
      return res.status(401).json({ error: "That email and password don't match." });
    }
    attempts.delete(key);
    setCookie(req, res, store.createSession(family.id, DEVICE_MS), DEVICE_MS);
    res.json({ ok: true });
  });

  app.post("/api/logout", (req, res) => {
    store.endSession(token(req));
    setCookie(req, res, "", 0);
    res.json({ ok: true });
  });

  app.post("/api/unlock", requireFamily, (req, res) => {
    const key = `pin:${req.family.id}`;
    if (tooMany(key)) return res.status(429).json({ error: "Too many tries. Wait 5 minutes and try again." });
    if (!checkSecret(String(req.body?.pin || ""), req.family.pinHash)) {
      failed(key);
      return res.status(401).json({ error: "That PIN isn't right." });
    }
    attempts.delete(key);
    req.sess.grownUntil = Date.now() + GROWNUP_MS;
    store.save();
    res.json({ ok: true });
  });

  app.post("/api/lock", requireFamily, (req, res) => {
    req.sess.grownUntil = 0;
    store.save();
    res.json({ ok: true });
  });

  // ---------- grown-ups ----------
  app.get("/api/parent/dashboard", requireGrownup, (req, res) => {
    const f = req.family;
    res.json({
      familyName: f.name,
      email: f.email,
      children: f.children.map((c) => fullChild(f, c)),
      parentPhones: f.parentPhones,
      messages: store.conversation(f, "parent"),
      smsNumber: process.env.SANTA_PHONE_NUMBER || null,
      smsEnabled: Boolean(twilioAuthToken),
    });
  });

  app.post("/api/parent/messages", requireGrownup, async (req, res) => {
    const text = String(req.body?.text || "").trim().slice(0, 1000);
    if (!text) return res.status(400).json({ error: "Say something to Santa!" });
    res.json(await handleParentText(req.family, text));
  });

  app.post("/api/parent/children", requireGrownup, (req, res) => {
    const { name, age } = req.body || {};
    if (!String(name || "").trim()) return res.status(400).json({ error: "Name required." });
    if (req.family.children.length >= 12) return res.status(400).json({ error: "That's a lot of elves! 12 children is the limit." });
    res.json(publicChild(store.addChild(req.family, { name, age })));
  });

  const withChild = (handler) => (req, res) => {
    const child = store.child(req.family, req.params.id);
    if (!child) return res.status(404).json({ error: "Child not found." });
    handler(req, res, child);
  };
  app.delete("/api/parent/children/:id", requireGrownup, withChild((req, res, child) => {
    store.removeChild(req.family, child.id);
    memos.removeChild(req.family.id, child.id);
    res.json({ ok: true });
  }));
  app.post("/api/parent/children/:id/reports", requireGrownup, withChild((req, res, child) => {
    const { kind, note } = req.body || {};
    store.addReport(child, kind, note || (kind === "nice" ? "Nice!" : "Naughty"));
    res.json({ ok: true });
  }));
  app.delete("/api/parent/children/:id/reports/:rid", requireGrownup, withChild((req, res, child) => {
    store.removeReport(child, req.params.rid);
    res.json({ ok: true });
  }));
  app.post("/api/parent/children/:id/wishes", requireGrownup, withChild((req, res, child) => {
    store.addWish(child, req.body?.item || "");
    res.json({ ok: true });
  }));
  app.delete("/api/parent/children/:id/wishes/:wid", requireGrownup, withChild((req, res, child) => {
    store.removeWish(child, req.params.wid);
    res.json({ ok: true });
  }));

  app.put("/api/parent/settings", requireGrownup, (req, res) => {
    const f = req.family;
    const { pin, password, currentPassword, parentPhones, childPhones, familyName } = req.body || {};
    if (pin !== undefined && pin !== "") {
      if (!/^\d{4,8}$/.test(String(pin))) return res.status(400).json({ error: "PIN must be 4-8 digits." });
      f.pinHash = hashSecret(pin);
    }
    if (password) {
      if (!checkSecret(String(currentPassword || ""), f.passwordHash)) return res.status(400).json({ error: "Your current password isn't right." });
      if (String(password).length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });
      f.passwordHash = hashSecret(password);
    }
    if (familyName) f.name = String(familyName).trim().slice(0, 60);
    const phones = [
      ...(Array.isArray(parentPhones) ? parentPhones : []),
      ...Object.values(childPhones && typeof childPhones === "object" ? childPhones : {}),
    ];
    const taken = phones.find((p) => store.phoneTaken(p, f.id));
    if (taken) return res.status(409).json({ error: `${taken} is already used by another family.` });
    if (Array.isArray(parentPhones)) f.parentPhones = parentPhones.map(normalizePhone).filter(Boolean);
    if (childPhones && typeof childPhones === "object") {
      for (const [id, phone] of Object.entries(childPhones)) {
        const c = store.child(f, id);
        if (c) c.phone = normalizePhone(phone);
      }
    }
    store.save();
    res.json({ ok: true });
  });

  app.delete("/api/parent/account", requireGrownup, (req, res) => {
    if (!checkSecret(String(req.body?.password || ""), req.family.passwordHash)) {
      return res.status(400).json({ error: "Type your password to delete the account." });
    }
    memos.removeFamily(req.family.id);
    store.deleteFamily(req.family);
    setCookie(req, res, "", 0);
    res.json({ ok: true });
  });

  // ---------- kids ----------
  app.get("/api/kid/:id/messages", requireFamily, (req, res) => {
    const child = store.child(req.family, req.params.id);
    if (!child) return res.status(404).json({ error: "Santa can't find that name!" });
    res.json({ child: publicChild(child), messages: store.conversation(req.family, `kid:${child.id}`) });
  });

  app.post("/api/kid/:id/messages", requireFamily, async (req, res) => {
    const child = store.child(req.family, req.params.id);
    if (!child) return res.status(404).json({ error: "Santa can't find that name!" });
    const text = String(req.body?.text || "").trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: "Type a message to Santa!" });
    res.json(await handleKidText(req.family, child, text));
  });

  // Santa's voice memo for one of his messages in a kid's chat.
  app.get("/api/kid/:id/memo/:mid", requireFamily, async (req, res) => {
    if (!tts) return res.status(404).json({ error: "Voice memos aren't turned on." });
    const child = store.child(req.family, req.params.id);
    if (!child) return res.status(404).json({ error: "Santa can't find that name!" });
    const msg = store.conversation(req.family, `kid:${child.id}`).find((m) => m.id === req.params.mid && m.from === "santa");
    if (!msg) return res.status(404).json({ error: "Memo not found." });
    const send = (file) => {
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.type("audio/mpeg").sendFile(file);
    };
    if (memos.has(req.family.id, child.id, msg.id)) return send(memos.file(req.family.id, child.id, msg.id));
    if (!store.useAllowance(req.family, dailyMemos, "memoUsage")) {
      return res.status(429).json({ error: "Santa's voice needs a rest. More voice memos tomorrow!" });
    }
    try {
      send(await memos.get(req.family.id, child.id, msg.id, msg.text, tts));
    } catch (err) {
      console.error("Voice memo failed:", err.message);
      res.status(502).json({ error: "Santa's voice memo got lost in the snow." });
    }
  });

  const RESTING = "Ho ho ho! Santa is resting his eyes for the night. 😴 Text me again tomorrow!";

  async function handleKidText(family, child, text) {
    const key = `kid:${child.id}`;
    store.appendMessage(family, key, "user", text);
    let reply;
    if (!store.useAllowance(family, dailyReplies)) {
      reply = RESTING;
    } else {
      const out = await replyToKid(child, store.conversation(family, key));
      for (const w of out.newWishes) store.addWish(child, w);
      reply = out.reply;
    }
    const msg = store.appendMessage(family, key, "santa", reply);
    return { reply, id: msg.id };
  }

  async function handleParentText(family, text) {
    store.appendMessage(family, "parent", "user", text);
    if (!store.useAllowance(family, dailyReplies)) {
      store.appendMessage(family, "parent", "santa", RESTING);
      return { reply: RESTING, recorded: { reports: [], wishes: [] } };
    }
    const { reply, reports, wishes } = await replyToParent(
      family.children,
      store.conversation(family, "parent"),
      (name) => store.childByName(family, name),
    );
    for (const r of reports) store.addReport(r.child, r.kind, r.note);
    for (const w of wishes) store.addWish(w.child, w.item);
    store.appendMessage(family, "parent", "santa", reply);
    return {
      reply,
      recorded: {
        reports: reports.map((r) => ({ child: r.child.name, kind: r.kind, note: r.note })),
        wishes: wishes.map((w) => ({ child: w.child.name, item: w.item })),
      },
    };
  }

  // ---------- real SMS via Twilio (optional) ----------
  app.post("/sms", async (req, res) => {
    if (!twilioAuthToken) return res.status(404).send("SMS is not set up");
    if (!validTwilioSignature(req, twilioAuthToken, publicUrl)) return res.status(403).send("Bad signature");
    const body = String(req.body?.Body || "").trim().slice(0, 1000);
    const who = store.identifyPhone(req.body?.From);
    let reply;
    if (!who) {
      reply = "Ho ho ho! Santa doesn't recognize this number yet. Ask a grown-up to add it in Santa's Book. 🎅";
    } else if (!body) {
      reply = "Ho ho ho! Did you mean to send Santa a message? 🎄";
    } else if (who.role === "parent") {
      reply = (await handleParentText(who.family, body)).reply;
    } else {
      reply = (await handleKidText(who.family, who.child, body)).reply;
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
  const server = createApp({ store }).listen(port, () => {
    console.log(`🎅 Santa is listening on port ${port}`);
    console.log(aiEnabled() ? "   Using Claude for Santa's replies." : "   No ANTHROPIC_API_KEY set: using Santa's built-in offline replies.");
  });
  const shutdown = () => {
    store.flush();
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
