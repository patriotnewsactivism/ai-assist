import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

type Phase = "loading" | "login" | "ready" | "error";

interface SessionInfo {
  authenticated: boolean;
  loginEnabled: boolean;
  authDisabled: boolean;
}

const card: React.CSSProperties = {
  maxWidth: 380,
  margin: "12vh auto 0",
  padding: 28,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-lg)",
  boxShadow: "var(--shadow-lg)",
  color: "var(--text)",
};

/**
 * Gates the app behind /api/auth. The session lives in an HttpOnly cookie, so every same-origin
 * fetch and the EventSource debate stream carry it automatically; nothing here stores the key.
 * A 401 from any other /api call (expired session) sends the user back to the login form.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [loginEnabled, setLoginEnabled] = useState(true);
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    setPhase("loading");
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const info = (await res.json()) as SessionInfo;
      setLoginEnabled(info.loginEnabled);
      setPhase(info.authenticated || info.authDisabled ? "ready" : "login");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not reach the server");
      setPhase("error");
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  // Expired or revoked session: any non-auth /api call returning 401 re-shows the login form.
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].pathname : args[0].url;
      if (res.status === 401 && url.includes("/api/") && !url.includes("/api/auth/")) {
        setMessage("Your session expired. Please sign in again.");
        setPhase("login");
      }
      return res;
    };
    return () => { window.fetch = original; };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        setKey("");
        setPhase("ready");
      } else if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { retryAfterSec?: number };
        const mins = Math.max(1, Math.ceil((body.retryAfterSec ?? 60) / 60));
        setMessage(`Too many failed attempts. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`);
      } else {
        setMessage("Invalid access key.");
      }
    } catch {
      setMessage("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setMessage("");
    setPhase("login");
  };

  if (phase === "ready") {
    return (
      <>
        {children}
        <button
          onClick={() => void signOut()}
          style={{ position: "fixed", right: 12, bottom: 12, zIndex: 50, padding: "6px 12px", fontSize: 12, color: "var(--text2)", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", cursor: "pointer" }}
        >
          Sign out
        </button>
      </>
    );
  }

  if (phase === "loading") return <div style={{ ...card, textAlign: "center", color: "var(--text2)" }}>Loading…</div>;

  if (phase === "error") {
    return (
      <div style={card}>
        <p style={{ marginBottom: 12 }}>Could not check your session ({message}).</p>
        <button onClick={() => void check()}>Retry</button>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={card}>
      <h1 style={{ fontSize: 20, marginBottom: 6 }}>AI Think Tank</h1>
      {loginEnabled ? (
        <>
          <p style={{ color: "var(--text2)", fontSize: 14, marginBottom: 16 }}>Enter the access key to continue.</p>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Access key"
            aria-label="Access key"
            style={{ width: "100%", padding: "10px 12px", marginBottom: 12, color: "var(--text)", background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: "var(--r-sm)" }}
          />
          <button type="submit" disabled={busy || !key} style={{ width: "100%", padding: "10px 12px", cursor: busy || !key ? "not-allowed" : "pointer" }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </>
      ) : (
        <p style={{ color: "var(--text2)", fontSize: 14 }}>Browser sign-in is not enabled on this server. Use an API key.</p>
      )}
      {message && <p role="alert" style={{ marginTop: 12, color: "var(--red)", fontSize: 13 }}>{message}</p>}
    </form>
  );
}
