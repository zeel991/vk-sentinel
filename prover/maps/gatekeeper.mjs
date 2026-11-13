// Gatekeeper circuit (GatekeeperEvaluation) input mapping.
// Inputs recovered from gatekeeper.wasm; the circuit only proves the decision its
// own rules allow, so the proof doubles as a check on the agent's decision.
import { randomBytes } from "node:crypto";
import sha3 from "js-sha3";
const { keccak256 } = sha3;

const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const field = (v) => (BigInt(v) % P).toString();

// The platform's task_id -> field mapping is unpublished. Candidates (same set another agent's code
// switches between); the Worker picks one per request via payload.taskIdEncoding (wrangler.toml
// TASKID_ENCODING) so practice can settle it without a prover redeploy.
const kec = (id) => BigInt("0x" + keccak256(String(id)));
export const TASK_ID_ENCODINGS = {
  keccakModP: (id) => kec(id) % P,
  keccakShr8: (id) => kec(id) >> 8n,
  utf8BigEndian: (id) => BigInt("0x" + (Buffer.from(String(id), "utf8").toString("hex") || "0")) % P,
  uuidTail: (id) => {
    const m = String(id).match(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i);
    return m ? BigInt("0x" + m[0].replace(/-/g, "")) : kec(id) % P;
  },
  hexDigits: (id) => BigInt("0x" + (String(id).replace(/[^0-9a-f]/gi, "") || "0")) % P,
};

export function taskIdField(taskId, encoding = "keccakModP") {
  const f = TASK_ID_ENCODINGS[encoding] ?? TASK_ID_ENCODINGS.keccakModP;
  return f(taskId).toString();
}

export default ({ input, taskId, decision, taskIdEncoding }) => ({
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
  taskId: taskIdField(taskId, taskIdEncoding),
  decision: decision === "APPROVE" ? "1" : "0",
  salt: (BigInt("0x" + randomBytes(31).toString("hex"))).toString(),
});

// The prover retries with this when the agent's decision cannot be proved.
export const alternate = (payload) => ({ ...payload, decision: payload.decision === "APPROVE" ? "REJECT" : "APPROVE" });
