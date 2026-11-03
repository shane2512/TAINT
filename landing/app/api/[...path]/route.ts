// Forwards /api/* to the TAINT runtime (npm run web). Read at request time so one build can point at MOCK or testnet.
// Each visitor gets a random id in a cookie, which the runtime uses to give them their own wallet, and the proxy
// passes on the visitor's address so the runtime's attack limit counts each person, not this server.
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const base = process.env.RUNTIME_URL ?? "http://127.0.0.1:3000";
  const existing = req.cookies.get("taint_sid")?.value;
  const sid = existing && /^[A-Za-z0-9_-]{1,64}$/.test(existing) ? existing : crypto.randomUUID();
  const ip = (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "").split(",")[0].trim();
  const headers: Record<string, string> = { "content-type": "application/json", "x-taint-session": sid };
  if (ip) headers["x-client-ip"] = ip;
  if (process.env.PROXY_KEY) headers["x-proxy-key"] = process.env.PROXY_KEY;
  let res: Response;
  try {
    res = await fetch(`${base}/${path.join("/")}${req.nextUrl.search}`, { method: req.method, headers, body: req.method === "POST" ? await req.text() : undefined, cache: "no-store", signal: AbortSignal.timeout(25_000) });
  } catch {
    // A hosted runtime on a free plan sleeps when idle and takes about a minute to wake; a local one is simply not started.
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(base);
    return Response.json(local
      ? { offline: true, error: "The TAINT runtime is not running. Start it with: npm run web" }
      : { offline: true, waking: true, error: "The demo server is waking up. It sleeps when idle and takes about a minute to start. This page will keep trying." }, { status: 503 });
  }
  const out = new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  if (!existing || existing !== sid) {
    const secure = req.nextUrl.protocol === "https:" ? "; Secure" : "";
    out.headers.append("set-cookie", `taint_sid=${sid}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax${secure}`);
  }
  return out;
}

export const GET = forward;
export const POST = forward;
