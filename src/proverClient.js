// Worker-side client for the remote Groth16 prover (prover/ on an always-on box).
// The prover registers its current tunnel URL with POST /prover/register.
const enc = new TextEncoder();

async function hmacHex(token, bytes) {
  const key = await crypto.subtle.importKey("raw", enc.encode(token.trim()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHex(a, b) {
  if (typeof a !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** POST /prover/register from the prover box: { url, circuits, ts } signed with PROVER_TOKEN. */
export async function handleRegister(request, env) {
  if (!env.PROVER_TOKEN) return new Response(null, { status: 404 });
  const raw = new Uint8Array(await request.arrayBuffer());
  if (!sameHex(request.headers.get("x-prover-signature") ?? "", await hmacHex(env.PROVER_TOKEN, raw))) {
    return new Response(null, { status: 401 });
  }
  const msg = JSON.parse(new TextDecoder().decode(raw));
  if (Math.abs(Date.now() - Number(msg.ts)) > 5 * 60_000) return new Response(null, { status: 409 });
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(msg.url ?? "")) return new Response(null, { status: 400 });
  await env.DB.prepare("INSERT INTO prover (id, url, circuits, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET url = excluded.url, circuits = excluded.circuits, updated_at = excluded.updated_at")
    .bind(msg.url, JSON.stringify(msg.circuits ?? []), new Date().toISOString()).run();
  return Response.json({ ok: true });
}

async function currentProver(env) {
  if (!env.PROVER_TOKEN) return null;
  const row = await env.DB.prepare("SELECT url, circuits, updated_at FROM prover WHERE id = 1").first();
  if (!row) return null;
  // Registrations refresh every 2 minutes; a stale one means the box or tunnel is down.
  if (Date.now() - Date.parse(row.updated_at) > 10 * 60_000) return null;
  return { url: row.url, circuits: JSON.parse(row.circuits) };
}

/**
 * Ask the prover for a proof. Returns { proof, public_signals, ms } or null.
 * Never throws and never waits longer than budgetMs, so a slow or missing prover
 * costs the proof, not the answer.
 */
export async function requestProof(env, circuit, payload, budgetMs, { allowAlternate = false } = {}) {
  if (budgetMs < 500) return null;
  const prover = await currentProver(env).catch(() => null);
  if (!prover || !prover.circuits.includes(circuit)) return null;
  const body = enc.encode(JSON.stringify({ circuit, payload, allowAlternate }));
  try {
    const r = await fetch(`${prover.url}/prove`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-prover-signature": await hmacHex(env.PROVER_TOKEN, body) },
      body,
      signal: AbortSignal.timeout(budgetMs),
    });
    const raw = new Uint8Array(await r.arrayBuffer());
    if (!sameHex(r.headers.get("x-prover-signature") ?? "", await hmacHex(env.PROVER_TOKEN, raw))) return null;
    const out = JSON.parse(new TextDecoder().decode(raw));
    if (!r.ok || !out.proof) { console.warn("prover error", r.status, out.error); return null; }
    return { proof: out.proof, public_signals: out.public_signals, verified: out.verified, alternate: Boolean(out.alternate), ms: out.ms };
  } catch (err) {
    console.warn("prover unreachable:", err?.name ?? err);
    return null;
  }
}

/** GET /prover/selftest, signed with PROVER_TOKEN over the query string: end-to-end pipeline check. */
export async function handleSelftest(request, env) {
  if (!env.PROVER_TOKEN) return new Response(null, { status: 404 });
  const url = new URL(request.url);
  const ts = url.searchParams.get("ts") ?? "";
  if (!sameHex(request.headers.get("x-prover-signature") ?? "", await hmacHex(env.PROVER_TOKEN, enc.encode(`selftest:${ts}`)))
      || Math.abs(Date.now() - Number(ts)) > 60_000) {
    return new Response(null, { status: 401 });
  }
  const t0 = Date.now();
  const prover = await currentProver(env);
  const result = await requestProof(env, "selftest", { a: 3, b: 11 }, 20_000);
  return Response.json({
    prover: prover ? { circuits: prover.circuits } : null,
    ok: Boolean(result?.proof),
    verified: result?.verified ?? null,
    public_signals: result?.public_signals ?? null,
    prove_ms: result?.ms ?? null,
    round_trip_ms: Date.now() - t0,
  });
}
