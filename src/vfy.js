// Steal the VFY: strategy, public-inputs hash and turn response.
// Pure functions, shared by the Worker and the tests.
import { keccak_256 } from "@noble/hashes/sha3";

// Published resolver numbers (build guide, "v1-draft"): FORTIFY costs 2 and
// blocks up to 6; EXTRACT takes up to 10. Per-turn balance swing (me - them):
//            opp HOLD  opp FORTIFY  opp EXTRACT
//   EXTRACT    +20        +10           0
//   FORTIFY     -2          0         -10
//   HOLD         0         +2         -20
// EXTRACT at the cap is never worse than any alternative, so the committed
// policy extracts the maximum while the opponent has anything to take.
export const POLICY = {
  name: "max-extract",
  version: "1",
  extractCap: 10,
};

export const ACTION_CODE = { HOLD: 0n, FORTIFY: 1n, EXTRACT: 2n };
export const CIRCUIT_VERSION_CODE = { "v1-draft": 1n };

const toBig = (v) => {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(v.trim())) return BigInt(v.trim());
  throw new Error(`not an integer: ${v}`);
};

// Matches the committed strategyParams [10, 0, ...] in the platform's VfyPolicyProof circuit:
// it proves EXTRACT 10 whenever the opponent has any balance (the resolver caps the take at
// what they have) and HOLD at zero. EXTRACT of a smaller amount cannot be proved.
export function chooseAction(state, policy = POLICY) {
  const opponent = toBig(state?.opponentBalance ?? 0);
  if (opponent <= 0n) return { type: "HOLD" };
  return { type: "EXTRACT", amount: policy.extractCap };
}

function word(v) {
  const n = toBig(v);
  if (n < 0n || n >= 1n << 256n) throw new Error("field out of range");
  const out = new Uint8Array(32);
  let x = n;
  for (let i = 31; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}

const hex = (bytes) => "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** keccak256 over 32-byte big-endian words, in the order the build guide specifies. */
export function publicInputsHash({ commitment, matchId, turn, selfBalance, opponentBalance, action, circuitVersion }) {
  const versionCode = CIRCUIT_VERSION_CODE[circuitVersion];
  if (versionCode === undefined) throw new Error(`unknown circuit version ${circuitVersion}`);
  const fields = [
    commitment,
    "0x" + String(matchId).replace(/-/g, ""),
    turn,
    selfBalance,
    opponentBalance,
    ACTION_CODE[action.type],
    action.type === "EXTRACT" ? action.amount : 0,
    versionCode,
  ].map(word);
  const buf = new Uint8Array(fields.length * 32);
  fields.forEach((w, i) => buf.set(w, i * 32));
  return hex(keccak_256(buf));
}

/**
 * Deterministic per-turn key: retries of the same turn reuse it, different turns never do.
 * Shaped as a valid RFC 4122 v4 UUID (version nibble 4, variant 10xx) so strict validators accept it.
 */
export function idempotencyKey(matchId, turn) {
  const h = keccak_256(new TextEncoder().encode(`steal-the-vfy:${matchId}:${turn}`));
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const s = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** @param registeredCommitment used when the envelope omits strategyCommitment (practice turns do) */
export function buildTurnResponse(env, now = new Date(), registeredCommitment) {
  const action = chooseAction(env.state);
  const circuitVersion = env.resolverVersion && CIRCUIT_VERSION_CODE[env.resolverVersion] !== undefined
    ? env.resolverVersion : "v1-draft";
  const policyProof = { circuitVersion };
  const commitment = env.strategyCommitment?.hash ?? registeredCommitment;
  if (commitment) {
    policyProof.publicInputsHash = publicInputsHash({
      commitment, matchId: env.matchId, turn: env.turn,
      selfBalance: env.state.selfBalance, opponentBalance: env.state.opponentBalance,
      action, circuitVersion,
    });
  }
  // The Groth16 proof and public_signals go here once the platform publishes
  // the policy circuit (.wasm/.zkey); see src/prover.js.
  return {
    matchId: env.matchId,
    turn: env.turn,
    // amount must be omitted for HOLD/FORTIFY, not sent as 0
    action: action.type === "EXTRACT" ? { type: "EXTRACT", amount: action.amount } : { type: action.type },
    policyProof,
    agentTimestamp: now.toISOString(),
    idempotencyKey: idempotencyKey(env.matchId, env.turn),
  };
}

export const isVfyTurn = (body) => body && body.eventId === "steal-the-vfy" && body.matchId !== undefined && body.turn !== undefined;
