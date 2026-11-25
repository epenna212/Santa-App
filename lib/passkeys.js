// Face ID / Touch ID / fingerprint sign-in using passkeys (WebAuthn).
import crypto from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

const FLOW_MS = 5 * 60 * 1000;

/** The site's identity for passkeys, taken from the request (works on localhost and on Render). */
export function relyingParty(req) {
  return { rpID: req.hostname, origin: `${req.protocol}://${req.get("host")}` };
}

export class Passkeys {
  constructor(store) {
    this.store = store;
    this.flows = new Map(); // flow token -> { challenge, kind, familyId, exp }
  }

  startFlow(kind, challenge, familyId = null) {
    const now = Date.now();
    for (const [k, f] of this.flows) if (f.exp < now) this.flows.delete(k);
    const flow = crypto.randomBytes(16).toString("hex");
    this.flows.set(flow, { challenge, kind, familyId, exp: now + FLOW_MS });
    return flow;
  }

  takeFlow(flow, kind) {
    const f = this.flows.get(String(flow || ""));
    this.flows.delete(String(flow || ""));
    if (!f || f.kind !== kind || f.exp < Date.now()) return null;
    return f;
  }

  async registrationOptions(req, family) {
    const { rpID } = relyingParty(req);
    const options = await generateRegistrationOptions({
      rpName: "Text Santa",
      rpID,
      userName: family.email,
      userDisplayName: family.name,
      userID: new TextEncoder().encode(family.id),
      attestationType: "none",
      excludeCredentials: (family.passkeys || []).map((p) => ({ id: p.id, transports: p.transports })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    return { options, flow: this.startFlow("register", options.challenge, family.id) };
  }

  async finishRegistration(req, family, flow, response, label) {
    const f = this.takeFlow(flow, "register");
    if (!f || f.familyId !== family.id) throw new Error("This Face ID setup expired. Please try again.");
    const { rpID, origin } = relyingParty(req);
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: f.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
    if (!result.verified) throw new Error("Face ID setup didn't work. Please try again.");
    const c = result.registrationInfo.credential;
    family.passkeys = family.passkeys || [];
    family.passkeys.push({
      id: c.id,
      publicKey: Buffer.from(c.publicKey).toString("base64url"),
      counter: c.counter,
      transports: c.transports || [],
      label: String(label || "This device").slice(0, 60),
      createdAt: new Date().toISOString(),
    });
    this.store.save();
  }

  async authenticationOptions(req) {
    const { rpID } = relyingParty(req);
    const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
    return { options, flow: this.startFlow("auth", options.challenge) };
  }

  /** Returns the family whose passkey signed in. */
  async finishAuthentication(req, flow, response) {
    const f = this.takeFlow(flow, "auth");
    if (!f) throw new Error("This Face ID sign-in expired. Please try again.");
    const credId = String(response?.id || "");
    let family = null, key = null;
    for (const fam of Object.values(this.store.data.families)) {
      key = (fam.passkeys || []).find((p) => p.id === credId);
      if (key) { family = fam; break; }
    }
    if (!family) throw new Error("This Face ID isn't set up for a family account yet. Sign in with your password, then turn on Face ID in Settings.");
    const { rpID, origin } = relyingParty(req);
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: f.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: { id: key.id, publicKey: Buffer.from(key.publicKey, "base64url"), counter: key.counter, transports: key.transports },
    });
    if (!result.verified) throw new Error("Face ID didn't match. Please try again.");
    key.counter = result.authenticationInfo.newCounter;
    key.lastUsedAt = new Date().toISOString();
    this.store.save();
    return family;
  }
}
