import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import express from "express";
import { ConcurrencyGate, SlidingWindowLimiter, loadLimits, principalOrIp, rateLimit } from "../rateLimit.js";

describe("SlidingWindowLimiter", () => {
  it("allows up to max, then blocks with a Retry-After that counts down", () => {
    const l = new SlidingWindowLimiter({ windowMs: 60_000, max: 2 });
    assert.equal(l.hit("a", 0).allowed, true);
    assert.equal(l.hit("a", 10_000).allowed, true);
    const blocked = l.hit("a", 20_000);
    assert.deepEqual([blocked.allowed, blocked.retryAfterSec], [false, 40]);
    assert.equal(l.hit("a", 59_999).allowed, false);
    assert.equal(l.hit("a", 60_001).allowed, true); // first hit aged out
  });
  it("rejected hits are not recorded, so a blocked client cannot extend its own lockout", () => {
    const l = new SlidingWindowLimiter({ windowMs: 1000, max: 1 });
    l.hit("a", 0);
    for (let t = 100; t < 900; t += 100) l.hit("a", t);
    assert.equal(l.hit("a", 1001).allowed, true);
  });
  it("keys are independent; reset and peek behave", () => {
    const l = new SlidingWindowLimiter({ windowMs: 1000, max: 1 });
    l.hit("a", 0);
    assert.equal(l.hit("b", 0).allowed, true);
    assert.equal(l.peek("a", 1).allowed, false);
    assert.equal(l.peek("a", 1).allowed, false); // peek never records
    l.reset("a");
    assert.equal(l.peek("a", 2).allowed, true);
  });
  it("record() counts failures unconditionally", () => {
    const l = new SlidingWindowLimiter({ windowMs: 1000, max: 2 });
    l.record("ip", 0);
    assert.equal(l.peek("ip", 1).allowed, true);
    l.record("ip", 2);
    assert.equal(l.peek("ip", 3).allowed, false);
  });
  it("bounds memory under a key spray", () => {
    const l = new SlidingWindowLimiter({ windowMs: 60_000, max: 1, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) l.hit(`ip${i}`, i);
    assert.ok(l.size() <= 100);
  });
});

describe("ConcurrencyGate", () => {
  it("caps in-flight work and release is idempotent", () => {
    const g = new ConcurrencyGate(2);
    const a = g.tryAcquire()!;
    const b = g.tryAcquire()!;
    assert.equal(g.tryAcquire(), null);
    a();
    a(); // double release must not free a second slot
    assert.equal(g.inFlight(), 1);
    assert.notEqual(g.tryAcquire(), null);
    assert.equal(g.tryAcquire(), null);
    b();
  });
});

describe("loadLimits", () => {
  it("has safe defaults and rejects junk instead of silently disabling limits", () => {
    const d = loadLimits({});
    assert.deepEqual([d.loginFailures, d.debatePerHour, d.maxConcurrentDebates], [5, 10, 2]);
    assert.throws(() => loadLimits({ THINKTANK_RL_DEBATE_PER_HOUR: "0" }), /between/);
    assert.throws(() => loadLimits({ THINKTANK_RL_DEBATE_PER_HOUR: "abc" }), /between/);
    assert.equal(loadLimits({ THINKTANK_RL_DEBATE_PER_HOUR: "3" }).debatePerHour, 3);
  });
});

describe("rateLimit middleware", () => {
  it("returns 429 with Retry-After and keys by principal, falling back to IP", async () => {
    const app = express();
    app.use((req, res, next) => {
      const p = req.headers["x-principal"];
      if (typeof p === "string") res.locals["principal"] = { id: p };
      next();
    });
    app.use(rateLimit(new SlidingWindowLimiter({ windowMs: 60_000, max: 1 }), principalOrIp));
    app.get("/", (_req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      assert.equal((await fetch(base, { headers: { "x-principal": "a" } })).status, 200);
      const blocked = await fetch(base, { headers: { "x-principal": "a" } });
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
      assert.equal((await fetch(base, { headers: { "x-principal": "b" } })).status, 200); // other principal unaffected
      assert.equal((await fetch(base)).status, 200); // IP bucket separate from principals
    } finally {
      server.close();
    }
  });
});
