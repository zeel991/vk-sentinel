import { test } from "node:test";
import assert from "node:assert/strict";
import { concat, keccak256, numberToHex } from "viem";
import { buildTurnResponse, chooseAction, idempotencyKey, isVfyTurn, publicInputsHash } from "../src/vfy.js";

const envelope = {
  protocolVersion: "v1", eventId: "steal-the-vfy", mode: "competition",
  matchId: "9f4e1b2a-1111-4222-8333-444455556666", turn: 3,
  issuedAt: "2026-10-23T13:00:00.000Z", deadlineAt: "2026-10-23T13:00:30.000Z",
  state: { selfBalance: "95", opponentBalance: "105", selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null },
  strategyCommitment: { hash: "0x" + "7d".repeat(31) + "91" },
  resolverVersion: "v1-draft", nonce: "3c2f1a",
};

// Exact copy of the build guide's reference implementation.
function referenceHash({ commitment, matchId, turn, selfBalance, opponentBalance, action, amount }) {
  return keccak256(concat([
    numberToHex(BigInt(commitment), { size: 32 }),
    numberToHex(BigInt("0x" + matchId.replace(/-/g, "")), { size: 32 }),
    numberToHex(BigInt(turn), { size: 32 }),
    numberToHex(BigInt(selfBalance), { size: 32 }),
    numberToHex(BigInt(opponentBalance), { size: 32 }),
    numberToHex({ HOLD: 0n, FORTIFY: 1n, EXTRACT: 2n }[action], { size: 32 }),
    numberToHex(BigInt(amount), { size: 32 }),
    numberToHex(1n, { size: 32 }),
  ]));
}

test("publicInputsHash matches the build guide's viem reference", () => {
  for (const [action, amount] of [["EXTRACT", 10], ["HOLD", 0], ["FORTIFY", 0], ["EXTRACT", 3]]) {
    const ours = publicInputsHash({
      commitment: envelope.strategyCommitment.hash, matchId: envelope.matchId, turn: 3,
      selfBalance: "95", opponentBalance: "105",
      action: action === "EXTRACT" ? { type: action, amount } : { type: action }, circuitVersion: "v1-draft",
    });
    const ref = referenceHash({ commitment: envelope.strategyCommitment.hash, matchId: envelope.matchId, turn: 3, selfBalance: "95", opponentBalance: "105", action, amount });
    assert.equal(ours, ref, `${action} ${amount}`);
  }
});

test("strategy: extract the cap whenever the opponent has anything, hold at zero", () => {
  assert.deepEqual(chooseAction({ opponentBalance: "105" }), { type: "EXTRACT", amount: 10 });
  // the policy circuit only proves EXTRACT 10 here, not EXTRACT 4
  assert.deepEqual(chooseAction({ opponentBalance: "4" }), { type: "EXTRACT", amount: 10 });
  assert.deepEqual(chooseAction({ opponentBalance: "0" }), { type: "HOLD" });
});

test("turn response echoes match and turn, omits amount for HOLD, stable idempotency key", () => {
  const r = buildTurnResponse(envelope, new Date("2026-10-23T13:00:01Z"));
  assert.equal(r.matchId, envelope.matchId);
  assert.equal(r.turn, 3);
  assert.deepEqual(r.action, { type: "EXTRACT", amount: 10 });
  assert.equal(r.policyProof.circuitVersion, "v1-draft");
  assert.match(r.policyProof.publicInputsHash, /^0x[0-9a-f]{64}$/);
  assert.equal(r.idempotencyKey, idempotencyKey(envelope.matchId, 3));
  assert.match(r.idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(idempotencyKey(envelope.matchId, 3), idempotencyKey(envelope.matchId, 4));

  const hold = buildTurnResponse({ ...envelope, state: { ...envelope.state, opponentBalance: "0" } });
  assert.deepEqual(hold.action, { type: "HOLD" });
  assert.equal("amount" in hold.action, false);
});

test("envelope detection", () => {
  assert.equal(isVfyTurn(envelope), true);
  assert.equal(isVfyTurn({ type: "agent-games.proof-gatekeeper.v1" }), false);
});
