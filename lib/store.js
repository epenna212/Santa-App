// Tiny JSON-file store. Good enough for one household; swap for a real DB to scale.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const EMPTY = () => ({
  setup: false,
  parentPinHash: null,
  parentPhones: [], // phone numbers (E.164) allowed to text in as a grown-up
  children: [], // { id, name, age, phone, wishes: [], reports: [] }
  conversations: {}, // key -> [{ from: "user" | "santa", text, at }]
});

export function hashPin(pin, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(pin), salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function checkPin(pin, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const candidate = hashPin(pin, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

export class Store {
  constructor(file) {
    this.file = file;
    this.data = EMPTY();
    if (file && fs.existsSync(file)) {
      this.data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, "utf8")) };
    }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  setup({ pin, children, parentPhones = [] }) {
    this.data.setup = true;
    this.data.parentPinHash = hashPin(pin);
    this.data.parentPhones = parentPhones.map(normalizePhone).filter(Boolean);
    this.data.children = [];
    for (const c of children) this.addChild(c);
    this.save();
  }

  addChild({ name, age, phone }) {
    const child = {
      id: crypto.randomUUID(),
      name: String(name).trim().slice(0, 40),
      age: age ? Number(age) : null,
      phone: normalizePhone(phone),
      wishes: [],
      reports: [],
    };
    this.data.children.push(child);
    this.save();
    return child;
  }

  removeChild(id) {
    this.data.children = this.data.children.filter((c) => c.id !== id);
    delete this.data.conversations[`kid:${id}`];
    this.save();
  }

  child(id) {
    return this.data.children.find((c) => c.id === id);
  }

  childByName(name) {
    const n = String(name || "").trim().toLowerCase();
    return this.data.children.find((c) => c.name.toLowerCase() === n);
  }

  addWish(childId, item) {
    const child = this.child(childId);
    const clean = String(item).trim().slice(0, 120);
    if (!child || !clean) return;
    if (child.wishes.some((w) => w.item.toLowerCase() === clean.toLowerCase())) return;
    child.wishes.push({ id: crypto.randomUUID(), item: clean, at: new Date().toISOString() });
    this.save();
  }

  removeWish(childId, wishId) {
    const child = this.child(childId);
    if (!child) return;
    child.wishes = child.wishes.filter((w) => w.id !== wishId);
    this.save();
  }

  addReport(childId, kind, note) {
    const child = this.child(childId);
    if (!child || !["nice", "naughty"].includes(kind)) return;
    child.reports.push({
      id: crypto.randomUUID(),
      kind,
      note: String(note).trim().slice(0, 300),
      at: new Date().toISOString(),
    });
    this.save();
  }

  removeReport(childId, reportId) {
    const child = this.child(childId);
    if (!child) return;
    child.reports = child.reports.filter((r) => r.id !== reportId);
    this.save();
  }

  conversation(key) {
    return (this.data.conversations[key] ||= []);
  }

  appendMessage(key, from, text) {
    const convo = this.conversation(key);
    convo.push({ from, text, at: new Date().toISOString() });
    if (convo.length > 200) convo.splice(0, convo.length - 200);
    this.save();
  }

  /** Who is texting from this phone number? */
  identifyPhone(phone) {
    const p = normalizePhone(phone);
    if (!p) return null;
    if (this.data.parentPhones.includes(p)) return { role: "parent" };
    const child = this.data.children.find((c) => c.phone === p);
    if (child) return { role: "kid", child };
    return null;
  }
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
