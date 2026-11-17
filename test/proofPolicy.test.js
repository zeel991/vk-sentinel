import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldProve, applyAlternate } from "../src/proofPolicy.js";

const replay = { decision: "REJECT", reason_code: "PROOF_REPLAY" };

test("replays and missing verification are not proved", () => {
  assert.equal(shouldProve(replay), false);
  assert.equal(shouldProve({ decision: "APPROVE", reason_code: "VALID_PROOF" }), true);
  assert.equal(shouldProve({ decision: "REJECT", reason_code: "VK_SUBSTITUTION" }), true);
  assert.equal(shouldProve({ decision: "REJECT", reason_code: "MISSING_VERIFICATION" }), false);
});

test("a replay keeps REJECT / PROOF_REPLAY even when the circuit proves APPROVE", () => {
  assert.deepEqual(applyAlternate(replay, { alternate: true }), replay);
  assert.deepEqual(applyAlternate(replay, { alternate: false }), replay);
  assert.deepEqual(applyAlternate(replay, null), replay);
});

test("other verdicts still follow the circuit's alternate", () => {
  assert.deepEqual(applyAlternate({ decision: "APPROVE", reason_code: "VALID_PROOF" }, { alternate: true }),
    { decision: "REJECT", reason_code: "PUBLIC_INPUT_MISMATCH" });
  assert.deepEqual(applyAlternate({ decision: "REJECT", reason_code: "THRESHOLD_MISMATCH" }, { alternate: true }),
    { decision: "APPROVE", reason_code: "VALID_PROOF" });
  const v = { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH" };
  assert.deepEqual(applyAlternate(v, { alternate: false }), v);
});
