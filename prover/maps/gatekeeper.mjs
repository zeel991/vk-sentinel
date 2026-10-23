// Gatekeeper circuit (GatekeeperEvaluation) input mapping.
// Inputs recovered from gatekeeper.wasm; the circuit only proves the decision its
// own rules allow, so the proof doubles as a check on the agent's decision.
import { createHash, randomBytes } from "node:crypto";

const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const field = (v) => (BigInt(v) % P).toString();

// Task ids look like "<prefix>_<uuid>": the uuid's 128 bits fit the field directly.
// Anything else falls back to sha256 reduced into the field.
export function taskIdField(taskId) {
  const tail = String(taskId).slice(-36).replace(/-/g, "");
  if (/^[0-9a-f]{32}$/i.test(tail)) return BigInt("0x" + tail).toString();
  return (BigInt("0x" + createHash("sha256").update(String(taskId)).digest("hex")) % P).toString();
}

export default ({ input, taskId, decision }) => ({
  registeredVkHash: field(input.registered_vk),
  proofVkHash: field(input.proof_vk),
  minimum: field(input.minimum),
  publicBalance: field(input.public_balance),
  expiryBlock: field(input.expiry_block),
  currentBlock: field(input.current_block),
  recipient: field(input.recipient),
  conditionRecipient: field(input.condition_recipient),
  amount: field(input.amount),
  maxTransfer: field(input.max_transfer),
  taskId: taskIdField(taskId),
  decision: decision === "APPROVE" ? "1" : "0",
  salt: (BigInt("0x" + randomBytes(31).toString("hex"))).toString(),
});

// The prover retries with this when the agent's decision cannot be proved.
export const alternate = (payload) => ({ ...payload, decision: payload.decision === "APPROVE" ? "REJECT" : "APPROVE" });
