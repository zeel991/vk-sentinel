// Steal the VFY circuit (VfyPolicyProof) input mapping.
// commitment = Poseidon(strategyParams[8], salt); strategy.json beside this file holds
// the params, salt and commitment as decimal strings (written by scripts/vfy-commit.mjs).
import { readFileSync } from "node:fs";

const strategy = JSON.parse(readFileSync(new URL("./strategy.json", import.meta.url), "utf8"));
const ACTION = { HOLD: "0", FORTIFY: "1", EXTRACT: "2" };
const VERSION = { "v1-draft": "1", v1: "1" };

export default ({ turn, action }) => ({
  strategyParams: strategy.params,
  salt: strategy.salt,
  commitment: strategy.commitment,
  matchId: BigInt("0x" + String(turn.matchId).replace(/-/g, "")).toString(),
  turnNumber: String(turn.turn),
  selfBalance: String(turn.state.selfBalance),
  opponentBalance: String(turn.state.opponentBalance),
  action: ACTION[action.type],
  amount: String(action.type === "EXTRACT" ? action.amount : 0),
  circuitVersion: VERSION[turn.resolverVersion] ?? "1",
});
