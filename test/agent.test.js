import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide } from "../src/decide.js";

const valid = {
  registered_vk: "0x7d91", proof_vk: "0x7D91",
  minimum: "1000", public_balance: "1460",
  expiry_block: 8430000, current_block: 8420000,
  recipient: "0xDe429f01", condition_recipient: "0xde429f01",
  amount: "500", max_transfer: "1000", proof_tx: "0xa82c",
};
const never = () => false;

test("seven trap categories", () => {
  assert.deepEqual(decide(valid, never), { decision: "APPROVE", reason_code: "VALID_PROOF" });
  assert.equal(decide({ ...valid, proof_vk: "0x13aa" }, never).reason_code, "VK_SUBSTITUTION");
  assert.equal(decide({ ...valid, public_balance: "999" }, never).reason_code, "THRESHOLD_MISMATCH");
  assert.equal(decide(valid, () => true).reason_code, "PROOF_REPLAY");
  assert.equal(decide({ ...valid, current_block: 8430001 }, never).decision, "REJECT");
  assert.equal(decide({ ...valid, condition_recipient: "0xbeef" }, never).decision, "REJECT");
  assert.equal(decide({ ...valid, amount: "1001" }, never).decision, "REJECT");
});

test("fails closed on missing or junk fields", () => {
  assert.equal(decide({ ...valid, proof_tx: "" }, never).reason_code, "MISSING_VERIFICATION");
  assert.equal(decide({ ...valid, minimum: "abc" }, never).decision, "REJECT");
  assert.equal(decide({ ...valid, amount: "1e9" }, never).decision, "REJECT");
  assert.equal(decide(null, never).decision, "REJECT");
});

const SECRET = "test-secret-0123456789abcdef";
const PORT = 18000 + Math.floor(Math.random() * 1000);
let proc;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "gk-"));
  proc = spawn(process.execPath, ["src/server.js"], {
    env: { ...process.env, PORT: String(PORT), AGENT_GAMES_HMAC_SECRET: SECRET, STATE_FILE: join(dir, "s.json") },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/health`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
after(() => proc.kill());

async function post(obj, secret = SECRET) {
  const body = JSON.stringify(obj);
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  const r = await fetch(`http://127.0.0.1:${PORT}/agent`, {
    method: "POST", headers: { "content-type": "application/json", "x-agent-games-signature": sig }, body,
  });
  const raw = await r.text();
  const expected = createHmac("sha256", SECRET).update(raw).digest("hex");
  assert.equal(r.headers.get("x-agent-games-signature"), expected, "response must be signed over raw body");
  return { status: r.status, json: JSON.parse(raw) };
}

const task = (id, input) => ({ type: "agent-games.proof-gatekeeper.v1", task_id: id, mode: "competition",
  deadline_at: new Date(Date.now() + 60_000).toISOString(), input });

test("preflight", async () => {
  const r = await post({ type: "agent-games.preflight.v1", agent_id: "agt_x", nonce: "abc" });
  assert.deepEqual(r, { status: 200, json: { ok: true, protocolVersion: "v1" } });
});

test("rejects bad signature", async () => {
  const r = await post({ type: "agent-games.preflight.v1" }, "wrong");
  assert.equal(r.status, 401);
});

test("approve, idempotent retry, then replay", async () => {
  const a = await post(task("gk_1", valid));
  assert.equal(a.json.decision, "APPROVE");
  assert.equal(a.json.proof_tx, "0xa82c");
  const retry = await post(task("gk_1", valid));
  assert.deepEqual(retry.json, a.json);
  const replay = await post(task("gk_2", { ...valid, proof_tx: "0xA82C" }));
  assert.equal(replay.json.reason_code, "PROOF_REPLAY");
});
