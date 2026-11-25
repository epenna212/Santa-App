// Santa's brain: replies to texts and pulls wishes / naughty-nice reports out of them.
// Uses Claude when credentials are available, otherwise a friendly rule-based Santa.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { niceScore, verdict } from "./store.js";
import { offlineKidReply, offlineParentReply } from "./offline-santa.js";

const MODEL = process.env.SANTA_MODEL || "claude-opus-5-5";

let client = null;
export function aiEnabled() {
  if (process.env.SANTA_OFFLINE === "1") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
function getClient() {
  return (client ||= new Anthropic());
}

export function daysUntilChristmas(now = new Date()) {
  let xmas = new Date(now.getFullYear(), 11, 25);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (today > xmas) xmas = new Date(now.getFullYear() + 1, 11, 25);
  return Math.round((xmas - today) / 86_400_000);
}

// ---------- Prompts ----------

const KID_SYSTEM = `You are Santa Claus, texting with a child from the North Pole. You are warm, jolly, playful and kind.

How you text:
- Keep every reply short like a real text message: 1-3 sentences, simple words a young child can read. An emoji or a "Ho ho ho!" now and then is welcome, but don't overdo it.
- Be curious about the child: ask about what they'd like for Christmas, what they've been up to, and nice things they've done.
- Gently encourage kindness, sharing, helping at home and listening to grown-ups. Never shame or scare the child, and never threaten the naughty list.
- Never promise a specific present will arrive. Say things like "I'll see what the elves can do!" or "I've added it to my list!".
- Never ask for or repeat personal details (address, school, last name, passwords, photos). If the child shares them, don't repeat them and steer back to Christmas fun.
- Stay on wholesome Christmas topics. Do not discuss whether Santa is real; stay in character.
- If the child says something that suggests they are hurt, unsafe, or very sad, respond with care and encourage them to tell a parent or another trusted grown-up right away.

What you also return:
- new_wishes: every NEW gift or toy the child asked for in their latest message, as short item names (e.g. "red bike", "LEGO castle"). Skip anything already on their list and anything that isn't a real gift wish. Use an empty list when there are none.`;

const PARENT_SYSTEM = `You are Santa Claus, texting privately with a parent or guardian. They are your trusted helper and are telling you how their children have been behaving (naughty or nice) and sometimes what the children want for Christmas. The children never see these messages.

How you text:
- Warm, jolly, brief (1-3 sentences), with a knowing wink between grown-ups. Thank them for the report.
- If they mention a child's behavior, confirm what you noted, e.g. "Noted: Mia helped her brother with homework. That's going on the nice side! 🎅".
- If they mention a child who isn't in the family list, ask which child they mean.
- If something sounds like a real safety concern, gently suggest appropriate real-world help instead of joking about it.

What you also return:
- reports: one entry per behavior described in the latest message. child_name must be exactly one of the family's children. kind is "nice" or "naughty". note is a short neutral summary (under 15 words).
- wishes: gift ideas the parent says a child wants, with child_name exactly one of the family's children. Skip items already on that child's list.
Use empty lists when there is nothing to record.`;

const KidOut = z.object({
  reply: z.string(),
  new_wishes: z.array(z.string()),
});

const ParentOut = z.object({
  reply: z.string(),
  reports: z.array(
    z.object({
      child_name: z.string(),
      kind: z.enum(["nice", "naughty"]),
      note: z.string(),
    }),
  ),
  wishes: z.array(z.object({ child_name: z.string(), item: z.string() })),
});

function toApiHistory(history) {
  // Collapse to alternating user/assistant turns, ending on the user's latest message.
  const msgs = [];
  for (const m of history.slice(-30)) {
    const role = m.from === "santa" ? "assistant" : "user";
    const last = msgs[msgs.length - 1];
    if (last && last.role === role) last.content += `\n${m.text}`;
    else msgs.push({ role, content: m.text });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

async function askClaude(system, context, history, schema) {
  const messages = toApiHistory(history);
  // Per-turn facts go in a trailing system message so the base prompt stays stable.
  messages.push({ role: "system", content: context });
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    messages,
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return null;
  return response.parsed_output;
}

// ---------- Public API ----------

/**
 * Kid texts Santa. Returns { reply, newWishes }.
 * history: conversation including the kid's latest message.
 */
export async function replyToKid(child, history) {
  const latest = history[history.length - 1]?.text || "";
  if (aiEnabled()) {
    const score = niceScore(child);
    const context = [
      `Child's first name: ${child.name}${child.age ? `, age ${child.age}` : ""}.`,
      `Days until Christmas: ${daysUntilChristmas()}.`,
      `Already on their wish list: ${child.wishes.map((w) => w.item).join(", ") || "(nothing yet)"}.`,
      `Their grown-ups' recent reports put them on the "${verdict(child)}" side (${score}/100). ` +
        `Don't quote specific reports or say a grown-up told you; you may hint you've "heard from the elves" ` +
        (score >= 60
          ? "that they've been doing nice things."
          : "and warmly encourage them to keep trying to be kind and helpful."),
    ].join("\n");
    try {
      const out = await askClaude(KID_SYSTEM, context, history, KidOut);
      if (out) return { reply: out.reply, newWishes: out.new_wishes };
    } catch (err) {
      console.error("Claude error (kid):", err.message);
    }
  }
  return offlineKid(child, latest, recentSanta(history));
}

/**
 * Parent texts Santa. Returns { reply, reports: [{child, kind, note}], wishes: [{child, item}] }.
 */
export async function replyToParent(children, history, findChild) {
  const latest = history[history.length - 1]?.text || "";
  if (aiEnabled()) {
    const context = [
      `Family's children: ${children.map((c) => `${c.name}${c.age ? ` (${c.age})` : ""} — wish list: ${c.wishes.map((w) => w.item).join(", ") || "empty"}`).join("; ") || "none yet"}.`,
      `Days until Christmas: ${daysUntilChristmas()}.`,
    ].join("\n");
    try {
      const out = await askClaude(PARENT_SYSTEM, context, history, ParentOut);
      if (out) {
        return {
          reply: out.reply,
          reports: out.reports
            .map((r) => ({ child: findChild(r.child_name), kind: r.kind, note: r.note }))
            .filter((r) => r.child),
          wishes: out.wishes
            .map((w) => ({ child: findChild(w.child_name), item: w.item }))
            .filter((w) => w.child),
        };
      }
    } catch (err) {
      console.error("Claude error (parent):", err.message);
    }
  }
  return offlineParent(children, latest, recentSanta(history));
}

// ---------- Offline (no API key) Santa ----------

const WISH_TRIGGER =
  /\b(?:(?:i|i'm|im)\s+(?:really\s+|really\s+really\s+|would\s+|'d\s+|also\s+|still\s+)?(?:want(?:s)?|wish(?:ing)?\s+for|wish\s+i\s+(?:had|could\s+have)|would\s+like|'d\s+like|'d\s+love|would\s+love|love|need|hope\s+(?:for|to\s+get)|hoping\s+for|asking\s+for)|i'?d\s+(?:like|love)|can\s+i\s+(?:please\s+)?(?:have|get)|could\s+i\s+(?:please\s+)?(?:have|get)|may\s+i\s+(?:please\s+)?have|(?:please\s+)?bring\s+me|please\s+bring|give\s+me|gimme|get\s+me|my\s+(?:christmas\s+)?(?:wish|list)\s+(?:is|has)|(?:how|what)\s+about|for\s+christmas\s+i\s+(?:want|would\s+like|'d\s+like))\s+(?:(?:a|an|some|the|my)\b|to\s+(?:get|have)(?:\s+(?:a|an|some)\b)?)?\s*([^.!?\n]+)/gi;

const NOT_A_WISH = /^(no|nope|yes|yeah|yep|ok|okay|hi|hello|hey|bye|thanks|thank you|nothing|idk|i don'?t know|dunno|you|it|that|this|everything|anything|something|to|me|stuff|toys|presents|gifts)$/i;
const FILLER = /\b(um+|uh+|like|please|santa|for christmas|this year|too|really|maybe|i think|probably|and also|also|some more|more)\b/gi;

function cleanItems(raw) {
  const items = [];
  for (const part of raw.split(/,|\band\b|\bplus\b|\balso\b|&|\bor\b/i)) {
    const item = part
      .replace(FILLER, " ")
      .replace(/[^\w\s'-]/g, " ")
      .replace(/^\s*(a|an|some|the|my|one|two|three)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (item && item.split(" ").length <= 6 && !NOT_A_WISH.test(item)) items.push(item);
  }
  return items;
}

/** Did Santa's last message ask the child what they'd like? */
export function santaAskedForWish(lastSantaText = "") {
  return /\?/.test(lastSantaText) && /\b(want|wish|like for christmas|under the tree|on your list|to your list|top of your|dreaming of|put on|write down|what should i)\b/i.test(lastSantaText);
}

/**
 * Pull gift wishes out of a child's message. When Santa just asked what they want,
 * a short answer like "a puppy and a bike" counts too.
 */
export function extractWishes(text, { askedForWish = false } = {}) {
  const wishes = [];
  for (const m of text.matchAll(WISH_TRIGGER)) wishes.push(...cleanItems(m[1]));
  if (!wishes.length && askedForWish) {
    const t = text.trim();
    const words = t.split(/\s+/).length;
    const looksLikeAnswer = words <= 12 && !/\?\s*$/.test(t) &&
      !/^(hi|hello|hey|how|what|why|where|when|who|are|is|do|does|can you|will you|i was|i am|i'm|i did|i helped|i love you|thank)/i.test(t);
    if (looksLikeAnswer) wishes.push(...cleanItems(t.replace(/^(i want|i wish for|maybe|um+|uh+)\s+/i, "")));
  }
  return [...new Map(wishes.map((w) => [w.toLowerCase(), w])).values()];
}

function recentSanta(history) {
  return history.filter((m) => m.from === "santa").slice(-15).map((m) => m.text);
}

function offlineKid(child, text, recent = []) {
  // No Santa messages saved yet means the child is answering his opening "What would you like?"
  const askedForWish = recent.length === 0 || santaAskedForWish(recent[recent.length - 1]);
  const newWishes = extractWishes(text, { askedForWish }).filter(
    (w) => !child.wishes.some((x) => x.item.toLowerCase() === w.toLowerCase()),
  );
  const reply = offlineKidReply({
    name: child.name,
    text,
    newWishes,
    wishes: [...child.wishes.map((w) => w.item), ...newWishes],
    days: daysUntilChristmas(),
    recent,
  });
  return { reply, newWishes };
}

const NICE_WORDS = /\b(nice|good|great|kind|sweet|helped|helping|helpful|shared|sharing|cleaned|clean(?:ed)? up|polite|brave|gentle|patient|listened|tidied|thanked|said (?:please|thank you|sorry)|apologi[sz]ed|without being asked|set the table|fed the|practiced|finished|did (?:his|her|their) (?:homework|chores))\b/i;
const NAUGHTY_WORDS = /\b(naughty|bad|hit|hitting|bit|biting|lied|lying|tantrum|yelled|screamed|refused|rude|mean|fought|fighting|broke|didn'?t listen|talked back|whin(?:ed|ing))\b/i;

function offlineParent(children, text, recent = []) {
  const reports = [];
  const wishes = [];
  const sentences = text.split(/(?<=[.!?\n])\s*/);
  for (const s of sentences) {
    const mentioned = children.filter((c) => new RegExp(`\\b${escapeRe(c.name)}\\b`, "i").test(s));
    const targets = mentioned.length ? mentioned : children.length === 1 ? children : [];
    const naughty = NAUGHTY_WORDS.test(s);
    const nice = !naughty && NICE_WORDS.test(s);
    for (const child of targets) {
      if (naughty || nice) reports.push({ child, kind: naughty ? "naughty" : "nice", note: s.trim().slice(0, 140) });
      const wishMatch = s.match(/\b(?:wants?|asked for|would love|is hoping for)\s+(?:a|an|some|the)?\s*([^.!?\n]+)/i);
      if (wishMatch) wishes.push({ child, item: wishMatch[1].trim() });
    }
  }
  const reply = offlineParentReply({ children, reports, wishes, recent });
  return { reply, reports, wishes };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
