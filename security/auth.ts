import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import express, { type Request, type RequestHandler, type Router } from "express";
import { SlidingWindowLimiter, clientIp } from "./rateLimit.js";

export interface ApiKey {
  id: string;
  key: string;
}

export interface AuthConfig {
  disabled: boolean;
  accessKey: string;
  apiKeys: ApiKey[];
  sessionSecret: string;
  sessionTtlMs: number;
  cookieName: string;
  secureCookie: boolean;
}

export interface Principal {
  kind: "session" | "apikey" | "disabled";
  id: string;
}

const MIN_KEY = 24;
const MIN_SECRET = 32;
export const SESSION_COOKIE = "tt_session";

/**
 * Fails closed: throws unless auth is fully configured. The only opt-out is
 * THINKTANK_AUTH=disabled, which is refused in production.
 */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const production = env["NODE_ENV"] === "production";
  const base = { sessionTtlMs: 12 * 60 * 60 * 1000, cookieName: SESSION_COOKIE, secureCookie: production };

  if (env["THINKTANK_AUTH"]?.trim().toLowerCase() === "disabled") {
    if (production) throw new Error("THINKTANK_AUTH=disabled is not allowed when NODE_ENV=production");
    return { ...base, disabled: true, accessKey: "", apiKeys: [], sessionSecret: "" };
  }

  const accessKey = (env["THINKTANK_ACCESS_KEY"] ?? "").trim();
  const sessionSecret = (env["THINKTANK_SESSION_SECRET"] ?? "").trim();
  const rawKeys = (env["THINKTANK_API_KEYS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  if (!accessKey && rawKeys.length === 0) {
    throw new Error("Set THINKTANK_ACCESS_KEY (browser login) and/or THINKTANK_API_KEYS (machine callers); refusing to start unauthenticated");
  }
  if (accessKey && accessKey.length < MIN_KEY) throw new Error(`THINKTANK_ACCESS_KEY must be at least ${MIN_KEY} characters`);
  if (accessKey && sessionSecret.length < MIN_SECRET) {
    throw new Error(`THINKTANK_SESSION_SECRET must be at least ${MIN_SECRET} characters when THINKTANK_ACCESS_KEY is set`);
  }

  // Format: `id:key` (id is a label for rate-limit buckets/audit); a bare key gets id key#N.
  const apiKeys = rawKeys.map((entry, i): ApiKey => {
    const idx = entry.indexOf(":");
    const id = idx > 0 ? entry.slice(0, idx) : `key#${i + 1}`;
    const key = idx > 0 ? entry.slice(idx + 1) : entry;
    if (!/^[\w.#-]{1,32}$/.test(id)) throw new Error(`THINKTANK_API_KEYS entry ${i + 1} has an invalid id`);
    if (key.length < MIN_KEY) throw new Error(`THINKTANK_API_KEYS entry "${id}" must be at least ${MIN_KEY} characters`);
    return { id, key };
  });
  if (new Set(apiKeys.map((k) => k.id)).size !== apiKeys.length) throw new Error("THINKTANK_API_KEYS ids must be unique");

  return { ...base, disabled: false, accessKey, apiKeys, sessionSecret };
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Length-independent constant-time comparison. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

// Session token: `<expiresAtMs>.<nonce>.<hmac>`; the HMAC covers expiry + nonce.
export function signSession(secret: string, now: number, ttlMs: number): string {
  const body = `${now + ttlMs}.${randomBytes(12).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifySession(secret: string, token: string | undefined, now: number): boolean {
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [exp, nonce, mac] = parts as [string, string, string];
  const expected = createHmac("sha256", secret).update(`${exp}.${nonce}`).digest("base64url");
  if (!safeEqual(mac, expected)) return false;
  const expiresAt = Number(exp);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function authenticate(
  cfg: AuthConfig,
  headers: { authorization?: string | undefined; cookie?: string | undefined },
  now = Date.now(),
): Principal | null {
  if (cfg.disabled) return { kind: "disabled", id: "dev" };

  const bearer = /^Bearer\s+(\S+)$/i.exec(headers.authorization ?? "")?.[1];
  if (bearer) {
    // Check every key (no early exit) so timing doesn't reveal which id matched.
    let matched: ApiKey | undefined;
    for (const k of cfg.apiKeys) if (safeEqual(bearer, k.key)) matched = k;
    return matched ? { kind: "apikey", id: matched.id } : null;
  }

  const token = parseCookies(headers.cookie)[cfg.cookieName];
  if (cfg.accessKey && verifySession(cfg.sessionSecret, token, now)) return { kind: "session", id: "ui" };
  return null;
}

/** Guards everything mounted after it. Sets res.locals.principal. */
export function requireAuth(cfg: AuthConfig, now: () => number = Date.now): RequestHandler {
  return (req, res, next) => {
    const principal = authenticate(cfg, { authorization: req.headers.authorization, cookie: req.headers.cookie }, now());
    if (!principal) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="thinktank"');
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    res.locals["principal"] = principal;
    next();
  };
}

function cookieHeader(cfg: AuthConfig, value: string, maxAgeSec: number): string {
  return [
    `${cfg.cookieName}=${value}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAgeSec}`,
    ...(cfg.secureCookie ? ["Secure"] : []),
  ].join("; ");
}

/** /api/auth/{login,logout,session}. Mounted before the guard; has its own failure lockout. */
export function authRouter(
  cfg: AuthConfig,
  loginFailures: SlidingWindowLimiter,
  now: () => number = Date.now,
): Router {
  const router = express.Router();
  const small = express.json({ limit: "2kb" });

  router.get("/session", (req, res) => {
    const principal = authenticate(cfg, { authorization: req.headers.authorization, cookie: req.headers.cookie }, now());
    res.setHeader("Cache-Control", "no-store");
    res.json({ authenticated: !!principal, loginEnabled: !!cfg.accessKey && !cfg.disabled, authDisabled: cfg.disabled });
  });

  router.post("/login", small, (req: Request, res) => {
    const ip = clientIp(req);
    const state = loginFailures.peek(ip, now());
    if (!state.allowed) {
      res.setHeader("Retry-After", String(state.retryAfterSec));
      res.status(429).json({ error: "Too many failed attempts", retryAfterSec: state.retryAfterSec });
      return;
    }
    const key = typeof (req.body as { key?: unknown } | undefined)?.key === "string" ? (req.body as { key: string }).key : "";
    if (!cfg.accessKey || !key || !safeEqual(key, cfg.accessKey)) {
      loginFailures.record(ip, now());
      res.status(401).json({ error: "Invalid access key" });
      return;
    }
    loginFailures.reset(ip);
    const ttlSec = Math.floor(cfg.sessionTtlMs / 1000);
    res.setHeader("Set-Cookie", cookieHeader(cfg, signSession(cfg.sessionSecret, now(), cfg.sessionTtlMs), ttlSec));
    res.json({ authenticated: true });
  });

  router.post("/logout", (_req, res) => {
    res.setHeader("Set-Cookie", cookieHeader(cfg, "", 0));
    res.json({ authenticated: false });
  });

  return router;
}
