// Cloudflare Workers entry (free plan): preflight + Proof Gatekeeper.
// Same policy as src/server.js; state lives in D1 so replay checks are
// strongly consistent across requests (KV can lag by up to a minute).
import { decide } from "./decide.js";

const enc = new TextEncoder();
let keyCache = null;

async function hmacKey(secret) {
  if (keyCache?.secret === secret) return keyCache.key;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  keyCache = { secret, key };
  return key;
}

async function sign(secret, bytes) {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), bytes);
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function send(env, status, obj) {
  const body = enc.encode(JSON.stringify(obj));
  return new Response(body, {
    status,
    headers: { "content-type": "application/json", "x-agent-games-signature": await sign(env.AGENT_GAMES_HMAC_SECRET, body) },
  });
}

async function handleGatekeeper(env, task) {
  const db = env.DB;
  const taskId = String(task.task_id ?? "");

  if (taskId) {
    const cached = await db.prepare("SELECT response FROM answers WHERE task_id = ?").bind(taskId).first("response");
    if (cached) return JSON.parse(cached); // platform retry: answer exactly the same
  }

  const input = task.input ?? {};
  const proofTx = typeof input.proof_tx === "string" ? input.proof_tx.trim().toLowerCase() : "";
  // Practice and scored rounds keep separate replay sets.
  const scope = task.mode === "competition" ? "competition" : "practice";

  // Claim the reference atomically, then see who owns it. Two concurrent
  // tasks with the same proof_tx cannot both come out as first.
  let owner = taskId;
  if (proofTx) {
    await db.prepare("INSERT OR IGNORE INTO proof_refs (scope, proof_tx, task_id, seen_at) VALUES (?, ?, ?, ?)")
      .bind(scope, proofTx, taskId, new Date().toISOString()).run();
    owner = await db.prepare("SELECT task_id FROM proof_refs WHERE scope = ? AND proof_tx = ?").bind(scope, proofTx).first("task_id");
  }

  const verdict = decide(input, () => owner !== taskId);
  // No Groth16 proof yet: the circuit is unpublished, and proving would not fit the free plan's 10 ms CPU.
  const response = { decision: verdict.decision, reason_code: verdict.reason_code };
  if (input.proof_tx) response.proof_tx = input.proof_tx;

  if (taskId) {
    await db.prepare("INSERT OR IGNORE INTO answers (task_id, mode, response, answered_at) VALUES (?, ?, ?, ?)")
      .bind(taskId, scope, JSON.stringify(response), new Date().toISOString()).run();
  }
  console.log(JSON.stringify({ task_id: taskId, mode: task.mode, ...verdict }));
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      return Response.json({ ok: true });
    }
    if (request.method !== "POST" || url.pathname !== (env.AGENT_PATH ?? "/agent")) {
      return new Response(null, { status: 404 });
    }

    const secret = env.AGENT_GAMES_HMAC_SECRET;
    if (!secret) return new Response("secret not configured", { status: 500 });

    const raw = new Uint8Array(await request.arrayBuffer());
    const given = (request.headers.get("x-agent-games-signature") ?? "").trim().replace(/^sha256=/i, "").toLowerCase();
    if (!safeEqual(given, await sign(secret, raw))) {
      console.warn("bad signature");
      return send(env, 401, { error: "invalid signature" });
    }

    let task;
    try {
      task = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return send(env, 400, { error: "invalid json" });
    }

    try {
      if (task.type === "agent-games.preflight.v1") return send(env, 200, { ok: true, protocolVersion: "v1" });
      if (task.type === "agent-games.proof-gatekeeper.v1") return send(env, 200, await handleGatekeeper(env, task));
      console.warn("unknown task type", task.type);
      return send(env, 400, { error: "unsupported task type" });
    } catch (err) {
      console.error("handler error:", err?.message);
      // Fail closed: a REJECT costs at most -3, an error response earns nothing.
      return send(env, 200, { decision: "REJECT", reason_code: "PROOF_INVALID", proof_tx: task?.input?.proof_tx });
    }
  },
};
