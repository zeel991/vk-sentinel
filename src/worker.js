// Cloudflare Workers entry (free plan): preflight + Proof Gatekeeper.
// Same policy as src/server.js; state lives in D1 so replay checks are
// strongly consistent across requests (KV can lag by up to a minute).
import { decide } from "./decide.js";
import { buildTurnResponse, isVfyTurn } from "./vfy.js";
import { handleRegister, handleSelftest, requestProof } from "./proverClient.js";

// Time left before a deadline, minus headroom for the response to travel back.
const budget = (deadline, headroomMs, capMs) => {
  const d = Date.parse(deadline ?? "");
  return Number.isFinite(d) ? Math.max(0, Math.min(d - Date.now() - headroomMs, capMs)) : 0;
};

const enc = new TextEncoder();
const keyCache = new Map();
// The rules describe a "32-byte random secret" shown as 64 hex chars. Whether the
// platform keys HMAC with the hex text or the decoded bytes is undocumented, so
// accept either and answer with whichever form verified the request.
let keyForm = "text";

function keyBytes(secret, form) {
  const s = secret.trim();
  if (form === "hex" && /^(0x)?[0-9a-fA-F]+$/.test(s) && s.replace(/^0x/, "").length % 2 === 0) {
    const h = s.replace(/^0x/, "");
    return Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16));
  }
  return form === "hex" ? null : enc.encode(s);
}

async function hmacKey(secret, form) {
  const id = `${form}:${secret}`;
  if (keyCache.has(id)) return keyCache.get(id);
  const raw = keyBytes(secret, form);
  const key = raw && (await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]));
  keyCache.set(id, key);
  return key;
}

async function sign(secret, bytes, form = keyForm) {
  const key = await hmacKey(secret, form);
  if (!key) return "";
  const mac = await crypto.subtle.sign("HMAC", key, bytes);
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

  let verdict = decide(input, () => owner !== taskId);
  // Proving runs on the remote prover (the free plan's 10 ms CPU can't); waiting on fetch costs no CPU.
  // Replays carry no proof to submit, and the circuit has no notion of reuse, so skip them.
  let zk = null;
  if (verdict.reason_code !== "PROOF_REPLAY" && verdict.reason_code !== "MISSING_VERIFICATION") {
    zk = await requestProof(env, "gatekeeper", { input, taskId, decision: verdict.decision },
      budget(task.deadline_at, 5_000, 40_000), { allowAlternate: true });
    if (zk?.alternate) {
      // The platform's circuit only proves the decision its rules allow; it is the referee.
      const flipped = verdict.decision === "APPROVE" ? "REJECT" : "APPROVE";
      console.warn(JSON.stringify({ task_id: taskId, circuit_overrode: verdict, to: flipped }));
      verdict = { decision: flipped, reason_code: flipped === "APPROVE" ? "VALID_PROOF" : "PUBLIC_INPUT_MISMATCH" };
    }
  }
  const response = { decision: verdict.decision, reason_code: verdict.reason_code };
  if (input.proof_tx) response.proof_tx = input.proof_tx;
  if (zk) { response.proof = zk.proof; response.public_signals = zk.public_signals; }

  if (taskId) {
    await db.prepare("INSERT OR IGNORE INTO answers (task_id, mode, response, answered_at) VALUES (?, ?, ?, ?)")
      .bind(taskId, scope, JSON.stringify(response), new Date().toISOString()).run();
  }
  console.log(JSON.stringify({ task_id: taskId, mode: task.mode, ...verdict }));
  return response;
}

async function handleVfyTurn(env, turnEnv) {
  const db = env.DB;
  const matchId = String(turnEnv.matchId);
  const turn = Number(turnEnv.turn);
  const cached = await db.prepare("SELECT response FROM vfy_turns WHERE match_id = ? AND turn = ?").bind(matchId, turn).first("response");
  if (cached) return JSON.parse(cached); // retry of the same turn: same action, same idempotencyKey

  const response = buildTurnResponse(turnEnv, new Date(), env.STRATEGY_COMMITMENT);
  const zk = await requestProof(env, "steal-the-vfy", { turn: turnEnv, action: response.action, publicInputsHash: response.policyProof.publicInputsHash }, budget(turnEnv.deadlineAt, 4_000, 20_000));
  if (zk) { response.policyProof.proof = zk.proof; response.policyProof.public_signals = zk.public_signals; }
  await db.prepare("INSERT OR IGNORE INTO vfy_turns (match_id, turn, mode, request, response, answered_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(matchId, turn, String(turnEnv.mode ?? ""), JSON.stringify(turnEnv), JSON.stringify(response), new Date().toISOString()).run();
  console.log(JSON.stringify({ event: "steal-the-vfy", matchId, turn, mode: turnEnv.mode, state: turnEnv.state, action: response.action }));
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/prover/register") return handleRegister(request, env);
    if (request.method === "GET" && url.pathname === "/prover/selftest") return handleSelftest(request, env);
    if (request.method !== "POST" || url.pathname !== (env.AGENT_PATH ?? "/agent")) {
      return new Response(null, { status: 404 });
    }

    const secret = env.AGENT_GAMES_HMAC_SECRET;
    if (!secret) return new Response("secret not configured", { status: 500 });

    const raw = new Uint8Array(await request.arrayBuffer());
    const given = (request.headers.get("x-agent-games-signature") ?? "").trim().replace(/^sha256=/i, "").toLowerCase();
    let matched = null;
    for (const form of ["text", "hex"]) {
      if (safeEqual(given, await sign(secret, raw, form))) { matched = form; break; }
    }
    if (!matched) {
      // Lengths only, never values: enough to tell a bad paste from a scheme mismatch.
      console.warn(`bad signature (secret length ${secret.trim().length}, signature length ${given.length})`);
      return send(env, 401, { error: "invalid signature" });
    }
    keyForm = matched;

    let task;
    try {
      task = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return send(env, 400, { error: "invalid json" });
    }

    try {
      if (task.type === "agent-games.preflight.v1") return send(env, 200, { ok: true, protocolVersion: "v1" });
      if (task.type === "agent-games.proof-gatekeeper.v1") return send(env, 200, await handleGatekeeper(env, task));
      if (isVfyTurn(task)) return send(env, 200, await handleVfyTurn(env, task));
      // Log the shape (keys only) of anything unrecognised so new envelope types can be added quickly.
      console.warn("unknown task type", task.type, JSON.stringify(Object.keys(task)));
      return send(env, 400, { error: "unsupported task type" });
    } catch (err) {
      console.error("handler error:", err?.message);
      if (isVfyTurn(task)) {
        // Still answer with a schema-valid move rather than let the turn time out.
        return send(env, 200, buildTurnResponse(task, new Date(), env.STRATEGY_COMMITMENT));
      }
      // Fail closed: a REJECT costs at most -3, an error response earns nothing.
      return send(env, 200, { decision: "REJECT", reason_code: "PROOF_INVALID", proof_tx: task?.input?.proof_tx });
    }
  },
};
