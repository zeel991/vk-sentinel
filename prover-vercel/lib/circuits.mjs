// Circuit registry for the serverless prover. Artifacts ship inside the function
// bundle (circuits/<name>/circuit.wasm, circuit.zkey, vkey.json); input mapping
// lives in ../maps (shared with prover/ on a self-hosted box).
import { existsSync, readFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { join } from "node:path";

const ROOT = join(process.cwd(), "circuits");
export const NAMES = ["gatekeeper", "steal-the-vfy"];

export function available() {
  return NAMES.filter((n) => existsSync(join(ROOT, n, "circuit.wasm")) && existsSync(join(ROOT, n, "circuit.zkey")));
}

const cache = new Map();
// Keep artifacts in memory across warm invocations; snarkjs accepts buffers in place of paths.
export function artifacts(name) {
  if (!cache.has(name)) {
    const d = join(ROOT, name);
    cache.set(name, {
      wasm: new Uint8Array(readFileSync(join(d, "circuit.wasm"))),
      zkey: new Uint8Array(readFileSync(join(d, "circuit.zkey"))),
      zkeyPath: join(d, "circuit.zkey"),
      vkey: JSON.parse(readFileSync(join(d, "vkey.json"), "utf8")),
    });
  }
  return cache.get(name);
}

const token = () => (process.env.PROVER_TOKEN ?? "").trim();
export const sign = (buf) => createHmac("sha256", token()).update(buf).digest("hex");
export function signatureOk(given, raw) {
  if (!token()) return false;
  const want = sign(raw);
  return typeof given === "string" && given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
}
