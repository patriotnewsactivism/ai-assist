import type { Request, RequestHandler } from "express";

export interface HitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * In-memory sliding-window log. State is per-process and resets on restart, which is
 * acceptable while railway.toml pins numReplicas = 1; a second replica would need a shared store.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly opts: { windowMs: number; max: number; maxKeys?: number },
  ) {}

  private prune(key: string, now: number): number[] {
    const cutoff = now - this.opts.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length === 0) this.hits.delete(key);
    else this.hits.set(key, list);
    return list;
  }

  private result(list: number[], now: number): HitResult {
    const allowed = list.length < this.opts.max;
    const oldest = list[0];
    const retryAfterSec = allowed || oldest === undefined
      ? 0
      : Math.max(1, Math.ceil((oldest + this.opts.windowMs - now) / 1000));
    return { allowed, remaining: Math.max(0, this.opts.max - list.length), retryAfterSec };
  }

  /** Records one hit if under the limit. Rejected hits are not recorded, so a blocked client can't extend its own lockout. */
  hit(key: string, now = Date.now()): HitResult {
    const list = this.prune(key, now);
    if (list.length >= this.opts.max) return this.result(list, now);
    list.push(now);
    this.hits.set(key, list);
    this.evictIfNeeded();
    return { allowed: true, remaining: this.opts.max - list.length, retryAfterSec: 0 };
  }

  /** Non-recording check. */
  peek(key: string, now = Date.now()): HitResult {
    return this.result(this.prune(key, now), now);
  }

  /** Records a hit unconditionally (for failure counting); returns state after. */
  record(key: string, now = Date.now()): HitResult {
    const list = this.prune(key, now);
    list.push(now);
    this.hits.set(key, list);
    this.evictIfNeeded();
    return this.result(list, now);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  size(): number {
    return this.hits.size;
  }

  // An address spray must not grow memory without bound: drop the oldest-inserted keys.
  private evictIfNeeded(): void {
    const cap = this.opts.maxKeys ?? 10_000;
    while (this.hits.size > cap) {
      const first = this.hits.keys().next().value;
      if (first === undefined) break;
      this.hits.delete(first);
    }
  }
}

/** Server-wide cap on simultaneously running expensive jobs. */
export class ConcurrencyGate {
  private active = 0;
  constructor(private readonly max: number) {}

  /** Returns a release function (idempotent), or null when full. */
  tryAcquire(): (() => void) | null {
    if (this.active >= this.max) return null;
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
    };
  }

  inFlight(): number {
    return this.active;
  }
}

export function clientIp(req: Pick<Request, "ip" | "socket">): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/** Authenticated principal id when present (set by the auth guard), else the client IP. */
export function principalOrIp(req: Request): string {
  const principal = (req.res?.locals as { principal?: { id?: string } } | undefined)?.principal;
  return principal?.id ? `p:${principal.id}` : `ip:${clientIp(req)}`;
}

export function rateLimit(
  limiter: SlidingWindowLimiter,
  keyFn: (req: Request) => string,
  now: () => number = Date.now,
): RequestHandler {
  return (req, res, next) => {
    const r = limiter.hit(keyFn(req), now());
    res.setHeader("RateLimit-Remaining", String(r.remaining));
    if (r.allowed) return next();
    res.setHeader("Retry-After", String(r.retryAfterSec));
    res.status(429).json({ error: "Too many requests", retryAfterSec: r.retryAfterSec });
  };
}

export interface Limits {
  loginFailures: number;
  debatePerHour: number;
  maxConcurrentDebates: number;
  heavyPer10Min: number;
  ttsPer10Min: number;
  generalPer10Min: number;
  preAuthPer10Min: number;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min = 1, max = 100_000): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

export function loadLimits(env: NodeJS.ProcessEnv = process.env): Limits {
  return {
    loginFailures: intEnv(env, "THINKTANK_RL_LOGIN_FAILS", 5),
    debatePerHour: intEnv(env, "THINKTANK_RL_DEBATE_PER_HOUR", 10),
    maxConcurrentDebates: intEnv(env, "THINKTANK_MAX_CONCURRENT_DEBATES", 2, 1, 50),
    heavyPer10Min: intEnv(env, "THINKTANK_RL_HEAVY_PER_10M", 30),
    ttsPer10Min: intEnv(env, "THINKTANK_RL_TTS_PER_10M", 120),
    generalPer10Min: intEnv(env, "THINKTANK_RL_GENERAL_PER_10M", 300),
    preAuthPer10Min: intEnv(env, "THINKTANK_RL_PREAUTH_PER_10M", 600),
  };
}
