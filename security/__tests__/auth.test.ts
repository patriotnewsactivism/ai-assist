import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import express from "express";
import { authRouter, authenticate, loadAuthConfig, parseCookies, requireAuth, safeEqual, signSession, verifySession } from "../auth.js";
import { SlidingWindowLimiter } from "../rateLimit.js";

const ACCESS = "a".repeat(24);
const SECRET = "s".repeat(32);
const KEY1 = "k1".repeat(12);
const KEY2 = "k2".repeat(12);
const good = { THINKTANK_ACCESS_KEY: ACCESS, THINKTANK_SESSION_SECRET: SECRET, THINKTANK_API_KEYS: `apex:${KEY1},${KEY2}` };

describe("loadAuthConfig (fails closed)", () => {
  it("refuses to start with nothing configured", () => assert.throws(() => loadAuthConfig({}), /refusing to start/));
  it("rejects short keys and secrets", () => {
    assert.throws(() => loadAuthConfig({ ...good, THINKTANK_ACCESS_KEY: "short" }), /at least 24/);
    assert.throws(() => loadAuthConfig({ ...good, THINKTANK_SESSION_SECRET: "short" }), /at least 32/);
    assert.throws(() => loadAuthConfig({ ...good, THINKTANK_API_KEYS: "apex:short" }), /at least 24/);
  });
  it("rejects duplicate ids and bad ids", () => {
    assert.throws(() => loadAuthConfig({ ...good, THINKTANK_API_KEYS: `x:${KEY1},x:${KEY2}` }), /unique/);
    assert.throws(() => loadAuthConfig({ ...good, THINKTANK_API_KEYS: `bad id:${KEY1}` }), /invalid id/);
  });
  it("parses ids, and labels bare keys", () => {
    assert.deepEqual(loadAuthConfig(good).apiKeys.map((k) => k.id), ["apex", "key#2"]);
  });
  it("allows API-key-only deployments without a session secret", () => {
    const c = loadAuthConfig({ THINKTANK_API_KEYS: KEY1 });
    assert.equal(c.accessKey, "");
  });
  it("allows THINKTANK_AUTH=disabled only outside production", () => {
    assert.equal(loadAuthConfig({ THINKTANK_AUTH: "disabled" }).disabled, true);
    assert.throws(() => loadAuthConfig({ THINKTANK_AUTH: "disabled", NODE_ENV: "production" }), /not allowed/);
  });
  it("marks cookies Secure only in production", () => {
    assert.equal(loadAuthConfig({ ...good, NODE_ENV: "production" }).secureCookie, true);
    assert.equal(loadAuthConfig(good).secureCookie, false);
  });
});

describe("tokens", () => {
  it("safeEqual is correct across lengths", () => {
    assert.equal(safeEqual("abc", "abc"), true);
    assert.equal(safeEqual("abc", "abcd"), false);
    assert.equal(safeEqual("", "x"), false);
  });
  it("sessions verify, expire, and reject tampering", () => {
    const t = signSession(SECRET, 1000, 5000);
    assert.equal(verifySession(SECRET, t, 2000), true);
    assert.equal(verifySession(SECRET, t, 6001), false); // expired
    assert.equal(verifySession("x".repeat(32), t, 2000), false); // wrong secret
    const [exp, nonce, mac] = t.split(".") as [string, string, string];
    assert.equal(verifySession(SECRET, `${Number(exp) + 99999}.${nonce}.${mac}`, 2000), false); // extended expiry
    assert.equal(verifySession(SECRET, `${exp}.${nonce}.${mac.slice(0, -2)}xx`, 2000), false);
    assert.equal(verifySession(SECRET, "garbage", 2000), false);
    assert.equal(verifySession(SECRET, undefined, 2000), false);
    assert.equal(verifySession("", t, 2000), false);
  });
  it("parseCookies handles multiple cookies and values with =", () => {
    assert.deepEqual(parseCookies("a=1; tt_session=x=y; b=2"), { a: "1", tt_session: "x=y", b: "2" });
  });
});

describe("authenticate", () => {
  const cfg = loadAuthConfig(good);
  it("accepts a configured bearer key and reports its id", () => {
    assert.deepEqual(authenticate(cfg, { authorization: `Bearer ${KEY1}` }), { kind: "apikey", id: "apex" });
    assert.deepEqual(authenticate(cfg, { authorization: `bearer ${KEY2}` }), { kind: "apikey", id: "key#2" });
  });
  it("rejects unknown/malformed bearers and does NOT fall back to the cookie", () => {
    const cookie = `tt_session=${signSession(SECRET, Date.now(), 60_000)}`;
    assert.equal(authenticate(cfg, { authorization: "Bearer nope" , cookie }), null);
    assert.equal(authenticate(cfg, { authorization: KEY1 }), null);
    assert.equal(authenticate(cfg, {}), null);
  });
  it("the browser access key is not itself a valid bearer", () => {
    assert.equal(authenticate(cfg, { authorization: `Bearer ${ACCESS}` }), null);
  });
  it("accepts a valid session cookie only when an access key is configured", () => {
    const cookie = `tt_session=${signSession(SECRET, Date.now(), 60_000)}`;
    assert.deepEqual(authenticate(cfg, { cookie }), { kind: "session", id: "ui" });
    const apiOnly = loadAuthConfig({ THINKTANK_API_KEYS: KEY1 });
    assert.equal(authenticate(apiOnly, { cookie }), null);
  });
});

async function withApp(cfg: ReturnType<typeof loadAuthConfig>, run: (base: string, now: { t: number }) => Promise<void>) {
  const clock = { t: 1_000_000 };
  const app = express();
  app.use("/api/auth", authRouter(cfg, new SlidingWindowLimiter({ windowMs: 15 * 60_000, max: 3 }), () => clock.t));
  app.use("/api", requireAuth(cfg, () => clock.t));
  app.get("/api/secret", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, clock);
  } finally {
    server.close();
  }
}
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("HTTP behavior", () => {
  it("guards /api, issues a hardened cookie on login, and honors logout", async () => {
    await withApp(loadAuthConfig({ ...good, NODE_ENV: "production" }), async (base) => {
      assert.equal((await fetch(`${base}/api/secret`)).status, 401);
      assert.equal((await fetch(`${base}/api/secret`, { headers: { authorization: `Bearer ${KEY1}` } })).status, 200);

      const bad = await post(`${base}/api/auth/login`, { key: "wrong" });
      assert.equal(bad.status, 401);
      assert.equal(bad.headers.get("set-cookie"), null);

      const ok = await post(`${base}/api/auth/login`, { key: ACCESS });
      assert.equal(ok.status, 200);
      const setCookie = ok.headers.get("set-cookie")!;
      for (const attr of ["HttpOnly", "SameSite=Strict", "Path=/", "Secure", "Max-Age=43200"]) assert.match(setCookie, new RegExp(attr));
      const cookie = setCookie.split(";")[0]!;

      assert.equal((await fetch(`${base}/api/secret`, { headers: { cookie } })).status, 200);
      const sess = (await (await fetch(`${base}/api/auth/session`, { headers: { cookie } })).json()) as { authenticated: boolean };
      assert.equal(sess.authenticated, true);

      const out = await post(`${base}/api/auth/logout`, {});
      assert.match(out.headers.get("set-cookie")!, /Max-Age=0/);
    });
  });
  it("session endpoint is public and reports unauthenticated", async () => {
    await withApp(loadAuthConfig(good), async (base) => {
      const s = (await (await fetch(`${base}/api/auth/session`)).json()) as { authenticated: boolean; loginEnabled: boolean };
      assert.deepEqual([s.authenticated, s.loginEnabled], [false, true]);
    });
  });
  it("locks out after repeated failures, even for the right key, then recovers", async () => {
    await withApp(loadAuthConfig(good), async (base, clock) => {
      for (let i = 0; i < 3; i++) assert.equal((await post(`${base}/api/auth/login`, { key: "wrong" })).status, 401);
      const locked = await post(`${base}/api/auth/login`, { key: ACCESS });
      assert.equal(locked.status, 429);
      assert.ok(Number(locked.headers.get("retry-after")) > 0);
      clock.t += 15 * 60_000 + 1;
      assert.equal((await post(`${base}/api/auth/login`, { key: ACCESS })).status, 200);
    });
  });
  it("rejects non-string and oversized login bodies", async () => {
    await withApp(loadAuthConfig(good), async (base) => {
      assert.equal((await post(`${base}/api/auth/login`, { key: { $ne: "" } })).status, 401);
      assert.equal((await post(`${base}/api/auth/login`, { key: "x".repeat(5000) })).status, 413);
    });
  });
  it("API-key-only deployments cannot log in via the browser route", async () => {
    await withApp(loadAuthConfig({ THINKTANK_API_KEYS: KEY1 }), async (base) => {
      assert.equal((await post(`${base}/api/auth/login`, { key: KEY1 })).status, 401);
    });
  });
});
