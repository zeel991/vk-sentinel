// Prints the Steal the VFY strategy commitment C = keccak256(W || R).
// W = the policy parameters in src/vfy.js, R = a private 32-byte salt.
// Provisional: the platform's policy circuit (unpublished) fixes the real
// Hash(W, R); recompute with it and re-register once it is out.
// usage: node scripts/commit.mjs [saltFile]   (creates the salt if missing)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3";
import { POLICY } from "../src/vfy.js";

const saltFile = process.argv[2] ?? ".strategy-salt";
if (!existsSync(saltFile)) writeFileSync(saltFile, randomBytes(32).toString("hex") + "\n", { mode: 0o600 });
const salt = Buffer.from(readFileSync(saltFile, "utf8").trim(), "hex");
if (salt.length !== 32) throw new Error("salt must be 32 bytes of hex");

const word = (n) => Buffer.from(BigInt(n).toString(16).padStart(64, "0"), "hex");
const witness = [POLICY.extractCap, Number(POLICY.version)].map(word);
const commitment = "0x" + Buffer.from(keccak_256(Buffer.concat([...witness, salt]))).toString("hex");

console.log(JSON.stringify({ commitmentHash: commitment, circuitVersion: "v1-draft", policyVersion: `${POLICY.name}-v${POLICY.version}` }, null, 2));
