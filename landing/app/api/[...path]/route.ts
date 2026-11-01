// Forwards /api/* to the TAINT runtime (npm run web). Read at request time so one build can point at MOCK or testnet.
// ponytail: every caller reaches the runtime as this proxy, so its per-address attack limit is global. Fine locally; forward the client address before hosting this publicly.
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const base = process.env.RUNTIME_URL ?? "http://127.0.0.1:3000";
  try {
    const res = await fetch(`${base}/${path.join("/")}`, {
      method: req.method,
      headers: { "content-type": "application/json" },
      body: req.method === "POST" ? await req.text() : undefined,
      cache: "no-store",
    });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ offline: true, error: "The TAINT runtime is not running. Start it with: npm run web" }, { status: 503 });
  }
}

export const GET = forward;
export const POST = forward;
