// Steal the VFY strategy commitment, as the platform's VfyPolicyProof circuit checks it:
//   commitment = Poseidon(strategyParams[0..7], salt)
// strategyParams [10, 0, ...]: EXTRACT 10 while the opponent has a balance, HOLD at zero.
// Writes the prover's strategy.json (decimal strings) and prints the dashboard values.
// usage: node scripts/vfy-commit.mjs [saltFile] [outFile]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { buildPoseidon } from "circomlibjs";

const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const PARAMS = [10n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
const saltFile = process.argv[2] ?? ".strategy-salt";
const outFile = process.argv[3] ?? "strategy.json";

if (!existsSync(saltFile)) writeFileSync(saltFile, randomBytes(32).toString("hex") + "\n", { mode: 0o600 });
const salt = BigInt("0x" + readFileSync(saltFile, "utf8").trim()) % P;

const poseidon = await buildPoseidon();
const commitment = BigInt(poseidon.F.toString(poseidon([...PARAMS, salt])));

writeFileSync(outFile, JSON.stringify({ params: PARAMS.map(String), salt: salt.toString(), commitment: commitment.toString() }) + "\n", { mode: 0o600 });
console.log(JSON.stringify({
  commitmentHash: "0x" + commitment.toString(16).padStart(64, "0"),
  circuitVersion: "v1-draft",
  policyVersion: "max-extract-v2",
  strategyFile: outFile,
}, null, 2));
