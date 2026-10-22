// Signed end-to-end check against a running agent.
// usage: AGENT_URL=https://.../agent AGENT_GAMES_HMAC_SECRET=... node test/smoke.mjs
// Uses mode "practice" and random ids so it never touches the competition replay set.
import { createHmac, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const URL_ = process.env.AGENT_URL;
const SECRET = process.env.AGENT_GAMES_HMAC_SECRET;
if (!URL_ || !SECRET) throw new Error("set AGENT_URL and AGENT_GAMES_HMAC_SECRET");

async function post(obj, secret = SECRET) {
  const body = JSON.stringify(obj);
  const t0 = Date.now();
  const r = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-games-signature": createHmac("sha256", secret).update(body).digest("hex") },
    body,
  });
  const raw = await r.text();
  assert.equal(r.headers.get("x-agent-games-signature"), createHmac("sha256", SECRET).update(raw).digest("hex"), "response signature");
  return { status: r.status, json: JSON.parse(raw), ms: Date.now() - t0 };
}

const run = randomUUID().slice(0, 8);
const valid = {
  registered_vk: "0x7d91", proof_vk: "0x7d91", minimum: "1000", public_balance: "1460",
  expiry_block: 8430000, current_block: 8420000, recipient: "0xde42", condition_recipient: "0xde42",
  amount: "500", max_transfer: "1000", proof_tx: `0xsmoke${run}`,
};
const task = (id, input) => ({ type: "agent-games.proof-gatekeeper.v1", task_id: `smoke_${run}_${id}`, mode: "practice",
  deadline_at: new Date(Date.now() + 60_000).toISOString(), input });

const checks = [
  ["preflight", async () => assert.deepEqual((await post({ type: "agent-games.preflight.v1", nonce: run })).json, { ok: true, protocolVersion: "v1" })],
  ["bad signature -> 401", async () => assert.equal((await post({ type: "agent-games.preflight.v1" }, "wrong")).status, 401)],
  ["valid -> APPROVE", async () => assert.equal((await post(task("a", valid))).json.decision, "APPROVE")],
  ["retry -> same answer", async () => assert.equal((await post(task("a", valid))).json.decision, "APPROVE")],
  ["replay -> PROOF_REPLAY", async () => assert.equal((await post(task("b", valid))).json.reason_code, "PROOF_REPLAY")],
  ["vk swap -> VK_SUBSTITUTION", async () => assert.equal((await post(task("c", { ...valid, proof_vk: "0x13aa", proof_tx: `0xvk${run}` }))).json.reason_code, "VK_SUBSTITUTION")],
  ["low balance -> THRESHOLD_MISMATCH", async () => assert.equal((await post(task("d", { ...valid, public_balance: "1", proof_tx: `0xth${run}` }))).json.reason_code, "THRESHOLD_MISMATCH")],
];

let failed = 0;
for (const [name, fn] of checks) {
  try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, "-", e.message); }
}
const t = await post({ type: "agent-games.preflight.v1", nonce: "timing" });
console.log(`preflight round trip: ${t.ms} ms`);
process.exit(failed ? 1 : 0);
