// Santa's voice memos, made with ElevenLabs text-to-speech and saved on disk so each
// memo is only paid for once.
import fs from "node:fs";
import path from "node:path";

const DEFAULT_VOICE = "pqHfZKP75CvOlQylNhV4"; // ElevenLabs premade voice "Bill" (wise, older American)

export function voiceEnabled() {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

/** Strip emoji and tidy text so it reads naturally aloud. */
export function speakableText(text) {
  return String(text)
    .replace(/\p{Extended_Pictographic}|️|‍/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

/** Default text-to-speech: returns an MP3 Buffer, or throws. */
export async function elevenLabsTts(text) {
  const voice = process.env.SANTA_VOICE_ID || DEFAULT_VOICE;
  const model = process.env.SANTA_VOICE_MODEL || "eleven_multilingual_v2";
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35 },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export class MemoStore {
  constructor(dir) {
    this.dir = dir ? path.resolve(dir) : null;
    this.inFlight = new Map();
  }

  file(familyId, childId, messageId) {
    const safe = (s) => String(s).replace(/[^\w-]/g, "");
    return path.join(this.dir, safe(familyId), safe(childId), `${safe(messageId)}.mp3`);
  }

  has(familyId, childId, messageId) {
    return Boolean(this.dir) && fs.existsSync(this.file(familyId, childId, messageId));
  }

  /** Returns the memo's file path, generating it with `tts` if needed. */
  async get(familyId, childId, messageId, text, tts) {
    const f = this.file(familyId, childId, messageId);
    if (fs.existsSync(f)) return f;
    if (this.inFlight.has(f)) return this.inFlight.get(f);
    const job = (async () => {
      const audio = await tts(speakableText(text));
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, audio);
      return f;
    })().finally(() => this.inFlight.delete(f));
    this.inFlight.set(f, job);
    return job;
  }

  removeChild(familyId, childId) {
    if (!this.dir) return;
    fs.rmSync(path.join(this.dir, String(familyId), String(childId)), { recursive: true, force: true });
  }

  removeFamily(familyId) {
    if (!this.dir) return;
    fs.rmSync(path.join(this.dir, String(familyId)), { recursive: true, force: true });
  }
}
