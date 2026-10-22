// Deterministic Proof Gatekeeper policy.
// Every check fails closed: anything missing or unparseable is a REJECT,
// because a wrong APPROVE costs -6 and a wrong REJECT only -3.

const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

function big(v) {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(v.trim())) return BigInt(v.trim());
  return null;
}

/**
 * @param {object} input  task.input from the platform
 * @param {(proofTx: string) => boolean} isReplay  true if proof_tx was already used by another task
 * @returns {{decision: "APPROVE"|"REJECT", reason_code: string}}
 */
export function decide(input, isReplay) {
  const reject = (reason_code) => ({ decision: "REJECT", reason_code });
  if (!input || typeof input !== "object") return reject("PROOF_INVALID");

  const registeredVk = norm(input.registered_vk);
  const proofVk = norm(input.proof_vk);
  const proofTx = norm(input.proof_tx);

  // 1. Verification key substitution (~13% of tasks)
  if (!registeredVk || !proofVk) return reject("VK_SUBSTITUTION");
  if (registeredVk !== proofVk) return reject("VK_SUBSTITUTION");

  // 2. No verification reference at all
  if (!proofTx) return reject("MISSING_VERIFICATION");

  // 3. Replay (~11%)
  if (isReplay(proofTx)) return reject("PROOF_REPLAY");

  // 4. Threshold mismatch (~8%): proved balance must meet the minimum
  const minimum = big(input.minimum);
  const publicBalance = big(input.public_balance);
  if (minimum === null || publicBalance === null) return reject("PUBLIC_INPUT_MISMATCH");
  if (publicBalance < minimum) return reject("THRESHOLD_MISMATCH");

  // 5. Expired condition (~6%)
  const expiry = big(input.expiry_block);
  const current = big(input.current_block);
  if (expiry === null || current === null) return reject("PUBLIC_INPUT_MISMATCH");
  if (current >= expiry) return reject("PUBLIC_INPUT_MISMATCH");

  // 6. Recipient mismatch (~6%)
  const recipient = norm(input.recipient);
  const conditionRecipient = norm(input.condition_recipient);
  if (!recipient || recipient !== conditionRecipient) return reject("PUBLIC_INPUT_MISMATCH");

  // 7. Amount overflow (~6%)
  const amount = big(input.amount);
  const maxTransfer = big(input.max_transfer);
  if (amount === null || maxTransfer === null) return reject("PUBLIC_INPUT_MISMATCH");
  if (amount <= 0n || amount > maxTransfer) return reject("PUBLIC_INPUT_MISMATCH");

  return { decision: "APPROVE", reason_code: "VALID_PROOF" };
}
