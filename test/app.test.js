import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../server.js";
import { Store, niceScore } from "../lib/store.js";
import { extractWishes } from "../lib/santa.js";

process.env.SANTA_OFFLINE = "1"; // never call the real API in tests

async function boot(opts = {}) {
  const store = new Store(null);
  const server = createApp({ store, ...opts }).listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
  return { store, server, base, call, clearCookie: () => (cookie = "") };
}

test("wish extraction", () => {
  assert.deepEqual(extractWishes("I want a red bike and a puppy!"), ["red bike", "puppy"]);
  assert.deepEqual(extractWishes("Can I please have a LEGO castle?"), ["LEGO castle"]);
  assert.deepEqual(extractWishes("hello santa"), []);
});

test("setup, kid chat, parent reports, privacy", async () => {
  const { store, server, call, clearCookie } = await boot();
  try {
    assert.equal((await call("GET", "/api/state")).body.setup, false);
    assert.equal((await call("POST", "/api/setup", { pin: "12", children: [{ name: "Mia" }] })).status, 400);
    assert.equal((await call("POST", "/api/setup", { pin: "1234", children: [{ name: "Mia", age: 6 }, { name: "Leo" }] })).status, 200);
    assert.equal((await call("POST", "/api/setup", { pin: "1234", children: [{ name: "X" }] })).status, 409);

    const { children } = (await call("GET", "/api/state")).body;
    const mia = children.find((c) => c.name === "Mia");

    const r = await call("POST", `/api/kid/${mia.id}/messages`, { text: "Hi Santa! I want a red bike and a puppy" });
    assert.equal(r.status, 200);
    assert.match(r.body.reply, /red bike/);
    assert.deepEqual(r.body.wishes, ["red bike", "puppy"]);

    const p = await call("POST", "/api/parent/messages", { text: "Mia set the table without being asked. Leo hit his sister." });
    assert.equal(p.status, 200);
    assert.deepEqual(p.body.recorded.reports.map((x) => [x.child, x.kind]), [["Mia", "nice"], ["Leo", "naughty"]]);

    const dash = (await call("GET", "/api/parent/dashboard")).body;
    assert.equal(dash.children.find((c) => c.name === "Mia").wishes.length, 2);
    assert.ok(niceScore(store.childByName("Mia")) > niceScore(store.childByName("Leo")));

    // Kids (no cookie) can't reach grown-up endpoints.
    clearCookie();
    assert.equal((await call("GET", "/api/parent/dashboard")).status, 401);
    assert.equal((await call("POST", "/api/parent/messages", { text: "hi" })).status, 401);
    assert.equal((await call("POST", "/api/parent/login", { pin: "0000" })).status, 401);
    assert.equal((await call("POST", "/api/parent/login", { pin: "1234" })).status, 200);
    assert.equal((await call("GET", "/api/parent/dashboard")).status, 200);
  } finally {
    server.close();
  }
});

test("SMS webhook routes by phone number and checks Twilio signature", async () => {
  const token = "test-token";
  const { store, server, base } = await boot({ twilioAuthToken: token, publicUrl: "https://santa.example.com" });
  try {
    store.setup({ pin: "1234", children: [{ name: "Mia", phone: "555-111-2222" }], parentPhones: ["+15553334444"] });
    const sms = async (params, signed = true) => {
      const url = "https://santa.example.com/sms";
      const data = Object.keys(params).sort().reduce((a, k) => a + k + params[k], url);
      const sig = crypto.createHmac("sha1", token).update(data).digest("base64");
      const res = await fetch(`${base}/sms`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...(signed ? { "x-twilio-signature": sig } : {}) },
        body: new URLSearchParams(params),
      });
      return { status: res.status, text: await res.text() };
    };

    assert.equal((await sms({ From: "+15551112222", Body: "hi" }, false)).status, 403);

    const kid = await sms({ From: "+15551112222", Body: "I want a sled" });
    assert.equal(kid.status, 200);
    assert.match(kid.text, /<Response><Message>.*sled.*<\/Message><\/Response>/s);
    assert.deepEqual(store.childByName("Mia").wishes.map((w) => w.item), ["sled"]);

    const parent = await sms({ From: "+15553334444", Body: "Mia was so kind to her grandma" });
    assert.match(parent.text, /nice/i);
    assert.equal(store.childByName("Mia").reports[0].kind, "nice");

    const stranger = await sms({ From: "+15550000000", Body: "hello" });
    assert.match(stranger.text, /doesn&apos;t recognize/);
  } finally {
    server.close();
  }
});
