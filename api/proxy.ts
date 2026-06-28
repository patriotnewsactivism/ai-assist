// Vercel Edge Function — proxies all /api/* requests to the Railway backend.
// Set BACKEND_URL in your Vercel project's environment variables to the Railway
// deployment URL, e.g. https://your-app.up.railway.app
// Streaming (SSE) is fully supported via the Edge runtime.

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const backendUrl = (process.env["BACKEND_URL"] ?? "").replace(/\/$/, "");

  if (!backendUrl) {
    return new Response(
      JSON.stringify({ error: "BACKEND_URL is not set. Configure it in your Vercel project environment variables." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  // Reconstruct the full target URL, preserving path + query string
  const incoming = new URL(req.url);
  const target = `${backendUrl}${incoming.pathname}${incoming.search}`;

  // Forward the request; pass body only for methods that carry one
  const hasBody = !["GET", "HEAD"].includes(req.method);

  const upstream = await fetch(target, {
    method: req.method,
    headers: req.headers,
    ...(hasBody ? { body: req.body, duplex: "half" } : {}),
  } as RequestInit & { duplex?: string });

  // Return the upstream response directly — headers, status, and streaming body intact
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
