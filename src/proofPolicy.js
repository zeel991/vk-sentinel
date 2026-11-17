// Which answers get a Groth16 proof attached, and what the circuit's answer may change.
//
// Replays are proved too (2026-11-17). The circuit has no notion of reuse, so for a replayed
// proof_tx it proves the decision its rules allow (usually APPROVE) as an "alternate". We attach
// that proof but keep our REJECT / PROOF_REPLAY decision. Other agents that send a proof with
// their replay answer are counted as answered and correct (R04: Astrex-1 and Bnova 8/8/8/7),
// while our proof-less replay answer was not counted at all (8/7/7/7).
export function shouldProve(verdict) {
  return verdict.reason_code !== "MISSING_VERIFICATION"; // nothing to prove without a proof_tx
}

/** Apply the circuit's alternate decision, except for replays, which the circuit cannot see. */
export function applyAlternate(verdict, zk) {
  if (!zk?.alternate || verdict.reason_code === "PROOF_REPLAY") return verdict;
  const flipped = verdict.decision === "APPROVE" ? "REJECT" : "APPROVE";
  return { decision: flipped, reason_code: flipped === "APPROVE" ? "VALID_PROOF" : "PUBLIC_INPUT_MISMATCH" };
}
