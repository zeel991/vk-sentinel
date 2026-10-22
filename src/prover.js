// Groth16 proof attached to every provable task (missing proof = -2).
// The platform has not published the Gatekeeper circuit (.wasm/.zkey) yet.
// Once it does: put the files in ./circuits, set CIRCUIT_WASM / CIRCUIT_ZKEY,
// and fill in witnessInput() with the signal names from the circuit.
import { existsSync } from "node:fs";

const WASM = process.env.CIRCUIT_WASM;
const ZKEY = process.env.CIRCUIT_ZKEY;

let snarkjs = null;
async function loadSnarkjs() {
  if (snarkjs) return snarkjs;
  snarkjs = await import("snarkjs");
  return snarkjs;
}

export function proverReady() {
  return Boolean(WASM && ZKEY && existsSync(WASM) && existsSync(ZKEY));
}

// TODO: map task input to the circuit's private/public signal names once published.
function witnessInput(input, decision) {
  return {
    registered_vk: BigInt(input.registered_vk).toString(),
    proof_vk: BigInt(input.proof_vk).toString(),
    minimum: String(input.minimum),
    public_balance: String(input.public_balance),
    expiry_block: String(input.expiry_block),
    current_block: String(input.current_block),
    amount: String(input.amount),
    max_transfer: String(input.max_transfer),
    decision: decision === "APPROVE" ? "1" : "0",
  };
}

/** Returns { proof, public_signals } or null; never throws, never exceeds budgetMs. */
export async function prove(input, decision, budgetMs) {
  if (!proverReady()) return null;
  const work = (async () => {
    const { groth16 } = await loadSnarkjs();
    const { proof, publicSignals } = await groth16.fullProve(witnessInput(input, decision), WASM, ZKEY);
    return { proof, public_signals: publicSignals };
  })();
  const timeout = new Promise((r) => setTimeout(() => r(null), budgetMs));
  try {
    return await Promise.race([work, timeout]);
  } catch (err) {
    console.error("prove failed:", err.message);
    return null;
  }
}
