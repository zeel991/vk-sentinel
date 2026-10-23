// Groth16 proving: witness with snarkjs, proof with iden3's native rapidsnark
// (about 7x faster than snarkjs on one core), falling back to snarkjs if the
// native prover is missing or fails. rapidsnark proofs are not re-verified here:
// the platform verifies every proof itself, an invalid proof costs no more than a
// missing one, and verifying costs ~50 ms warm and ~600 ms on a cold start.
import * as snarkjs from "snarkjs";
import { execFile } from "node:child_process";
import { copyFileSync, chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const BUNDLED = join(process.cwd(), "bin", "rapidsnark");
const TMP_BIN = "/tmp/rapidsnark";

// Bundled files may lose their exec bit; run a /tmp copy instead.
let native = null;
function nativeProver() {
  if (native !== null) return native;
  try {
    if (!existsSync(TMP_BIN)) { copyFileSync(BUNDLED, TMP_BIN); chmodSync(TMP_BIN, 0o755); }
    native = TMP_BIN;
  } catch (err) {
    console.error("rapidsnark unavailable:", err.message);
    native = false;
  }
  return native;
}

/** @returns {{ proof, publicSignals, engine }} — throws only if the circuit rejects the input. */
export async function prove(input, { wasm, zkeyPath, zkey, vkey }) {
  const t = [performance.now()];
  const wtns = { type: "mem" };
  await snarkjs.wtns.calculate(input, wasm, wtns); // throws when the circuit's rules reject the input
  t.push(performance.now());

  const bin = nativeProver();
  if (bin) {
    const id = randomBytes(8).toString("hex");
    const w = `/tmp/${id}.wtns`, pf = `/tmp/${id}.proof.json`, pb = `/tmp/${id}.public.json`;
    try {
      writeFileSync(w, wtns.data);
      await run(bin, [zkeyPath, w, pf, pb], { timeout: 8_000 });
      t.push(performance.now());
      const proof = JSON.parse(readFileSync(pf, "utf8"));
      const publicSignals = JSON.parse(readFileSync(pb, "utf8"));
      return { proof, publicSignals, engine: "rapidsnark", timing: { witness: Math.round(t[1] - t[0]), native: Math.round(t[2] - t[1]) } };
    } catch (err) {
      console.error("rapidsnark failed; falling back to snarkjs:", String(err.message).split("\n")[0]);
    } finally {
      for (const f of [w, pf, pb]) rmSync(f, { force: true });
    }
  }
  const { proof, publicSignals } = await snarkjs.groth16.prove(zkey, wtns);
  if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof))) throw new Error("snarkjs proof failed verification");
  return { proof, publicSignals, engine: "snarkjs" };
}
