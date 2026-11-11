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
  // A fixed prover (prover-vercel/) takes precedence over a self-registered tunnel.
  if (env.PROVER_URL) return { url: env.PROVER_URL, circuits: ["gatekeeper", "steal-the-vfy"] };
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

// A fixed sample Gatekeeper task: valid condition, so the circuit proves APPROVE.
function sampleProof(env) {
  const vk = "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";
  return requestProof(env, "gatekeeper", {
    input: { registered_vk: vk, proof_vk: vk, minimum: "1000", public_balance: "1460", expiry_block: 8430000, current_block: 8420000,
      recipient: "0xabcdef1234567890abcdef1234567890abcdef12", condition_recipient: "0xabcdef1234567890abcdef1234567890abcdef12",
      amount: "500", max_transfer: "1000" },
    taskId: "selftest_00000000-0000-4000-8000-000000000000", decision: "APPROVE",
  }, 20_000);
}

/**
 * Records a sample-proof outcome so GET /health shows whether proofs are working.
 * Called by /prover/selftest, which an always-on box (prover/check-timer) hits every
 * 5 minutes: that keeps the serverless prover in use (an idle Vercel deployment once
 * stopped serving its functions for ~2 weeks unnoticed).
 */
async function recordProverCheck(env, result, t0) {
  const ok = Boolean(result?.proof);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO prover_health (id, ok, checked_at, last_ok_at, ms) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET ok = excluded.ok, checked_at = excluded.checked_at, ms = excluded.ms,
        last_ok_at = COALESCE(excluded.last_ok_at, prover_health.last_ok_at)`)
    .bind(ok ? 1 : 0, now, ok ? now : null, Date.now() - t0).run();
  if (!ok) console.error(JSON.stringify({ prover_check: "FAILED", ms: Date.now() - t0 }));
}

export async function proverStatus(env) {
  return env.DB.prepare("SELECT ok, checked_at, last_ok_at, ms FROM prover_health WHERE id = 1").first().catch(() => null);
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
  const result = await sampleProof(env).catch(() => null);
  await recordProverCheck(env, result, t0).catch((err) => console.error("prover_health write failed:", err?.message));
  return Response.json({
    prover: prover ? { circuits: prover.circuits } : null,
    ok: Boolean(result?.proof),
    verified: result?.verified ?? null,
    public_signals: result?.public_signals ?? null,
    prove_ms: result?.ms ?? null,
    round_trip_ms: Date.now() - t0,
  });
}
