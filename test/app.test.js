import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server.js";
import { Store, niceScore } from "../lib/store.js";
import { extractWishes } from "../lib/santa.js";

process.env.SANTA_OFFLINE = "1"; // never call the real API in tests

async function boot(opts = {}, store = new Store(null)) {
  const server = createApp({ store, ...opts }).listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { store, server, base };
}

/** A browser-like client with its own cookie jar. */
function client(base) {
  let cookie = "";
  return async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(method !== "GET" ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: method !== "GET" ? JSON.stringify(body || {}) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
}

const signup = (call, overrides = {}) =>
  call("POST", "/api/signup", {
    familyName: "The Claus Test Family",
    email: "mom@example.com",
    password: "candycane1",
    pin: "1234",
    children: [{ name: "Mia", age: 6 }, { name: "Leo" }],
    ...overrides,
  });

test("wish extraction", () => {
  assert.deepEqual(extractWishes("I want a red bike and a puppy!"), ["red bike", "puppy"]);
  assert.deepEqual(extractWishes("Can I please have a LEGO castle?"), ["LEGO castle"]);
  assert.deepEqual(extractWishes("hello santa"), []);
});

test("sign up, kids chat, grown-up reports, PIN lock", async () => {
  const { store, server, base } = await boot();
  const call = client(base);
  try {
    assert.equal((await call("GET", "/api/state")).body.signedIn, false);
    assert.equal((await signup(call, { password: "short" })).status, 400);
    assert.equal((await signup(call, { pin: "12" })).status, 400);
    assert.equal((await signup(call)).status, 200);
    assert.equal((await signup(client(base))).status, 409, "email can only be used once");

    const state = (await call("GET", "/api/state")).body;
    assert.equal(state.signedIn, true);
    assert.equal(state.grownup, true, "new account starts unlocked");
    const mia = state.children.find((c) => c.name === "Mia");

    const r = await call("POST", `/api/kid/${mia.id}/messages`, { text: "Hi Santa! I want a red bike and a puppy" });
    assert.equal(r.status, 200);
    assert.match(r.body.reply, /red bike/);

    const p = await call("POST", "/api/parent/messages", { text: "Mia set the table without being asked. Leo hit his sister." });
    assert.deepEqual(p.body.recorded.reports.map((x) => [x.child, x.kind]), [["Mia", "nice"], ["Leo", "naughty"]]);

    const dash = (await call("GET", "/api/parent/dashboard")).body;
    assert.deepEqual(dash.children.find((c) => c.name === "Mia").wishes.map((w) => w.item), ["red bike", "puppy"]);
    const fam = store.familyByEmail("mom@example.com");
    assert.ok(niceScore(store.childByName(fam, "Mia")) > niceScore(store.childByName(fam, "Leo")));

    // Lock: kids can still chat, but Santa's Book needs the PIN.
    await call("POST", "/api/lock");
    assert.equal((await call("GET", "/api/parent/dashboard")).status, 403);
    assert.equal((await call("POST", "/api/parent/messages", { text: "hi" })).status, 403);
    assert.equal((await call("POST", `/api/kid/${mia.id}/messages`, { text: "hello" })).status, 200);
    assert.equal((await call("POST", "/api/unlock", { pin: "0000" })).status, 401);
    assert.equal((await call("POST", "/api/unlock", { pin: "1234" })).status, 200);
    assert.equal((await call("GET", "/api/parent/dashboard")).status, 200);

    // Another device signs in with email + password and starts locked.
    const phone2 = client(base);
    assert.equal((await phone2("POST", "/api/login", { email: "MOM@example.com", password: "wrong-pass" })).status, 401);
    assert.equal((await phone2("POST", "/api/login", { email: "MOM@example.com", password: "candycane1" })).status, 200);
    assert.equal((await phone2("GET", "/api/state")).body.grownup, false);
    assert.equal((await phone2("GET", "/api/parent/dashboard")).status, 403);

    // Signed-out visitors get nothing.
    const stranger = client(base);
    assert.equal((await stranger("GET", `/api/kid/${mia.id}/messages`)).status, 401);
  } finally {
    server.close();
  }
});

test("families are kept apart", async () => {
  const { server, base } = await boot();
  try {
    const a = client(base), b = client(base);
    await signup(a, { email: "a@example.com" });
    await signup(b, { email: "b@example.com", children: [{ name: "Zoe" }] });
    const aKid = (await a("GET", "/api/state")).body.children[0];
    assert.equal((await b("GET", `/api/kid/${aKid.id}/messages`)).status, 404);
    assert.equal((await b("POST", `/api/parent/children/${aKid.id}/reports`, { kind: "naughty" })).status, 404);
    assert.deepEqual((await b("GET", "/api/state")).body.children.map((c) => c.name), ["Zoe"]);
  } finally {
    server.close();
  }
});

test("rejects form posts to the API (CSRF guard)", async () => {
  const { server, base } = await boot();
  try {
    const res = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "email=a" });
    assert.equal(res.status, 415);
  } finally {
    server.close();
  }
});

test("daily reply allowance", async () => {
  const { server, base } = await boot({ dailyReplies: 2 });
  const call = client(base);
  try {
    await signup(call);
    const kid = (await call("GET", "/api/state")).body.children[0];
    await call("POST", `/api/kid/${kid.id}/messages`, { text: "hi" });
    await call("POST", `/api/kid/${kid.id}/messages`, { text: "hi" });
    const third = await call("POST", `/api/kid/${kid.id}/messages`, { text: "hi" });
    assert.match(third.body.reply, /resting/);
  } finally {
    server.close();
  }
});

test("data survives a restart", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "santa-")), "santa.json");
  const s1 = new Store(file);
  s1.createFamily({ email: "x@example.com", password: "password1", pin: "1234", children: [{ name: "Ava" }] });
  s1.flush();
  const s2 = new Store(file);
  assert.equal(s2.familyByEmail("x@example.com").children[0].name, "Ava");
});

test("SMS webhook routes by phone number and checks Twilio signature", async () => {
  const token = "test-token";
  const { store, server, base } = await boot({ twilioAuthToken: token, publicUrl: "https://santa.example.com" });
  try {
    const fam = store.createFamily({ email: "p@example.com", password: "password1", pin: "1234", children: [] });
    const mia = store.addChild(fam, { name: "Mia", phone: "555-111-2222" });
    fam.parentPhones = ["+15553334444"];
    const sms = async (params, signed = true) => {
      const url = "https://santa.example.com/sms";
      const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
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
    assert.match(kid.text, /<Response><Message>.*sled.*<\/Message><\/Response>/s);
    assert.deepEqual(mia.wishes.map((w) => w.item), ["sled"]);
    const parent = await sms({ From: "+15553334444", Body: "Mia was so kind to her grandma" });
    assert.match(parent.text, /nice/i);
    assert.equal(mia.reports[0].kind, "nice");
    assert.match((await sms({ From: "+15550000000", Body: "hello" })).text, /doesn&apos;t recognize/);
  } finally {
    server.close();
  }
});
