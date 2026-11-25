// JSON-file store holding many families. Good for hundreds of families on one server;
// swap for a real database if it grows past that.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function hashSecret(secret, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(secret), salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function checkSecret(secret, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const candidate = hashSecret(secret, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

export class Store {
  constructor(file) {
    this.file = file;
    this.data = { version: 2, families: {}, sessions: {} };
    if (file && fs.existsSync(file)) {
      const loaded = JSON.parse(fs.readFileSync(file, "utf8"));
      if (loaded.version === 2) this.data = loaded;
    }
    this.saveTimer = null;
  }

  save() {
    if (!this.file) return;
    // Coalesce bursts of writes into one disk write.
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 50);
  }

  flush() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  // ---------- families ----------
  familyByEmail(email) {
    const e = normalizeEmail(email);
    return Object.values(this.data.families).find((f) => f.email === e);
  }

  family(id) {
    return this.data.families[id];
  }

  createFamily({ familyName, email, password, pin, children = [], parentPhones = [] }) {
    const family = {
      id: crypto.randomUUID(),
      name: String(familyName || "").trim().slice(0, 60) || "Our family",
      email: normalizeEmail(email),
      passwordHash: hashSecret(password),
      pinHash: hashSecret(pin),
      parentPhones: parentPhones.map(normalizePhone).filter(Boolean),
      children: [],
      conversations: {},
      usage: { day: "", count: 0 },
      createdAt: new Date().toISOString(),
    };
    this.data.families[family.id] = family;
    for (const c of children) this.addChild(family, c);
    this.save();
    return family;
  }

  deleteFamily(family) {
    delete this.data.families[family.id];
    for (const [k, s] of Object.entries(this.data.sessions)) if (s.familyId === family.id) delete this.data.sessions[k];
    this.save();
  }

  // ---------- sessions (a signed-in device) ----------
  createSession(familyId, ms) {
    const token = crypto.randomBytes(32).toString("hex");
    this.data.sessions[sha(token)] = { familyId, exp: Date.now() + ms, grownUntil: 0 };
    this.pruneSessions();
    this.save();
    return token;
  }

  session(token) {
    if (!token) return null;
    const s = this.data.sessions[sha(token)];
    if (!s || s.exp < Date.now() || !this.family(s.familyId)) return null;
    return s;
  }

  endSession(token) {
    if (token) delete this.data.sessions[sha(token)];
    this.save();
  }

  pruneSessions() {
    const now = Date.now();
    for (const [k, s] of Object.entries(this.data.sessions)) if (s.exp < now) delete this.data.sessions[k];
  }

  // ---------- children ----------
  addChild(family, { name, age, phone }) {
    const child = {
      id: crypto.randomUUID(),
      name: String(name).trim().slice(0, 40),
      age: age ? Number(age) : null,
      phone: normalizePhone(phone),
      wishes: [],
      reports: [],
    };
    family.children.push(child);
    this.save();
    return child;
  }

  removeChild(family, id) {
    family.children = family.children.filter((c) => c.id !== id);
    delete family.conversations[`kid:${id}`];
    this.save();
  }

  child(family, id) {
    return family.children.find((c) => c.id === id);
  }

  childByName(family, name) {
    const n = String(name || "").trim().toLowerCase();
    return family.children.find((c) => c.name.toLowerCase() === n);
  }

  addWish(child, item) {
    const clean = String(item).trim().slice(0, 120);
    if (!child || !clean) return;
    if (child.wishes.some((w) => w.item.toLowerCase() === clean.toLowerCase())) return;
    child.wishes.push({ id: crypto.randomUUID(), item: clean, at: new Date().toISOString() });
    this.save();
  }

  removeWish(child, wishId) {
    child.wishes = child.wishes.filter((w) => w.id !== wishId);
    this.save();
  }

  addReport(child, kind, note) {
    if (!child || !["nice", "naughty"].includes(kind)) return;
    child.reports.push({
      id: crypto.randomUUID(),
      kind,
      note: String(note).trim().slice(0, 300),
      at: new Date().toISOString(),
    });
    if (child.reports.length > 500) child.reports.splice(0, child.reports.length - 500);
    this.save();
  }

  removeReport(child, reportId) {
    child.reports = child.reports.filter((r) => r.id !== reportId);
    this.save();
  }

  conversation(family, key) {
    return (family.conversations[key] ||= []);
  }

  appendMessage(family, key, from, text) {
    const convo = this.conversation(family, key);
    const msg = { id: crypto.randomUUID(), from, text, at: new Date().toISOString() };
    convo.push(msg);
    if (convo.length > 200) convo.splice(0, convo.length - 200);
    this.save();
    return msg;
  }

  /** Counts a Santa reply against the family's daily allowance. Returns false when used up. */
  useAllowance(family, perDay, field = "usage") {
    const day = new Date().toISOString().slice(0, 10);
    if (!family[field] || family[field].day !== day) family[field] = { day, count: 0 };
    if (family[field].count >= perDay) return false;
    family[field].count += 1;
    this.save();
    return true;
  }

  /** Who is texting from this phone number? */
  identifyPhone(phone) {
    const p = normalizePhone(phone);
    if (!p) return null;
    for (const family of Object.values(this.data.families)) {
      if (family.parentPhones.includes(p)) return { family, role: "parent" };
      const child = family.children.find((c) => c.phone === p);
      if (child) return { family, role: "kid", child };
    }
    return null;
  }

  phoneTaken(phone, exceptFamilyId) {
    const p = normalizePhone(phone);
    if (!p) return false;
    const who = this.identifyPhone(p);
    return Boolean(who && who.family.id !== exceptFamilyId);
  }
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`; // assume US/Canada
  return `+${digits}`;
}

/** Nice score from 0 (very naughty) to 100 (very nice). Starts at 70: most kids are mostly nice! */
export function niceScore(child) {
  let score = 70;
  for (const r of child.reports) score += r.kind === "nice" ? 6 : -8;
  return Math.max(0, Math.min(100, score));
}

export function verdict(child) {
  const s = niceScore(child);
  if (s >= 80) return "Very Nice";
  if (s >= 60) return "Nice";
  if (s >= 40) return "A Little Naughty";
  return "Naughty (for now!)";
}
