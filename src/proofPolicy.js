// Which answers get a Groth16 proof attached, and what the circuit's answer may change.
//
// Replays carry no proof: the circuit has no notion of reuse, so it cannot prove REJECT /
// PROOF_REPLAY for a proof that is otherwise valid. Staff confirmed (ticket #4153, 2026-11-17)
// that the uncounted R04 replay was a platform bug, not our answer format; they neutralise it
// and re-run that task on 21 Nov. (A 16:20 IST change that attached an alternate proof to
// replays was reverted the same evening.)
export function shouldProve(verdict) {
  return verdict.reason_code !== "PROOF_REPLAY" && verdict.reason_code !== "MISSING_VERIFICATION";
}

/** Apply the circuit's alternate decision. Replays are never proved, so never flipped. */
export function applyAlternate(verdict, zk) {
  if (!zk?.alternate || verdict.reason_code === "PROOF_REPLAY") return verdict;
  const flipped = verdict.decision === "APPROVE" ? "REJECT" : "APPROVE";
  return { decision: flipped, reason_code: flipped === "APPROVE" ? "VALID_PROOF" : "PUBLIC_INPUT_MISMATCH" };
}
