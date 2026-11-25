# 🎅 Text Santa

A text-message app where **kids text Santa** about what they want for Christmas, and **parents privately tell Santa** whether their kids have been naughty or nice.

- **Kids** pick their name and chat with Santa in a phone-style chat. Any gifts they mention go onto their wish list automatically.
- **Families sign up** with an email and password, so you can share one link with friends and every family gets its own private North Pole.
- **Grown-ups** use a PIN-protected "grown-ups line" to text Santa reports like *"Mia set the table without being asked"*. Santa logs each one as nice or naughty.
- **Santa's Book** is the parents' dashboard. It shows each child's wish list, a naughty-to-nice meter, the behavior log, quick 😇/😈 buttons, and the child's full chat with Santa.
- Santa never tells kids what their parents reported. He may hint that "the elves" have noticed them being nice, or gently encourage them to keep trying.
- **Real SMS (optional):** connect a Twilio number so the family can text Santa from real phones. Each phone number is mapped to a grown-up or a child.

## Run it

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # optional, see below
npm start                             # http://localhost:3000
```

Open it, tap **Create family account**, add your children and choose a grown-up PIN.

### Santa's brain

- With an `ANTHROPIC_API_KEY`, Santa's replies come from Claude (`claude-opus-5-5`, low effort for snappy replies). Claude uses structured output to return the reply together with any wishes or naughty/nice reports, so the app records them reliably. The kid prompt keeps Santa short and kind. He never promises specific gifts, never asks for personal details, and tells a child to talk to a trusted grown-up if they sound unsafe.
- Without a key, Santa still works with built-in, rule-based replies and keyword detection.

| Env var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on Claude-powered Santa |
| `SANTA_MODEL` | Override the model (default `claude-opus-5-5`) |
| `PORT` | Port (default 3000) |
| `DATA_FILE` | Where data is saved (default `data/santa.json`) |
| `TWILIO_AUTH_TOKEN` | Verifies that SMS webhooks really come from Twilio |
| `DAILY_REPLIES_PER_FAMILY` | Cap on Santa replies per family per day, to protect your API bill (default 300) |
| `SANTA_PHONE_NUMBER` | Santa's Twilio number, shown to families in Settings |
| `PUBLIC_URL` | Your public base URL, e.g. `https://santa.example.com` (used for Twilio signature checks) |

### Real text messages with Twilio

1. Deploy the app somewhere public (or use a tunnel like ngrok) and set `PUBLIC_URL` and `TWILIO_AUTH_TOKEN`.
2. In the Twilio console, set your phone number's **"A message comes in"** webhook to `POST {PUBLIC_URL}/sms`.
3. In **Santa's Book → Settings**, enter the grown-ups' and kids' phone numbers.

Texts from a grown-up's number go to the private grown-ups line. Texts from a child's number go to that child's chat. Unknown numbers get a polite "ask a grown-up to add you" reply.

## Put it online with Render

1. Get a Claude API key at console.anthropic.com (API keys → Create key). Add a few dollars of credit; each Santa reply costs a fraction of a cent.
2. In Render: **New → Blueprint**, connect your GitHub account if asked, and pick this repository (branch `claude/santa-texting-app-hsa4of` unless the code has been merged to `main`).
3. Render reads `render.yaml` and asks for `ANTHROPIC_API_KEY`. Paste your key and click **Apply / Deploy**.
4. When it shows **Live**, open the `https://text-santa-….onrender.com` link, create your family account, and share the link with family and friends.

The blueprint uses Render's **Starter** plan with a 1 GB disk, because free instances can't keep files: on the free plan everyone's accounts and wish lists would vanish whenever the app restarts. Check Render's pricing page for the current cost.

## Tests

```bash
npm test
```

## Notes

- Data is stored in one JSON file on the disk, which is fine for hundreds of families. Move to a database if it grows well beyond that.
- A device stays signed in for a year; the PIN unlock lasts 2 hours. Password and PIN guesses are rate-limited.
- There is no "forgot password" email yet, so write your password down.

## Hosted version (no setup)

`artifact/text-santa.html` is a single-page version that runs as a Claude artifact. It saves the family's data in the artifact's own database and gets Santa's replies from Claude through the viewer's Claude account, so it needs no server or API key. Real SMS is only available in the Node app.
