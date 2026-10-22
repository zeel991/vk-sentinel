// Groth16 prover for the Agent Games Worker. Runs on an always-on Linux box,
// listens on localhost only; tunnel.mjs exposes it to the Worker.
//
// circuits/<name>/circuit.wasm + circuit.zkey + map.mjs
//   map.mjs default-exports (payload) => circuit input signals.
// Requests are HMAC-SHA256 signed with PROVER_TOKEN (x-prover-signature).
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as snarkjs from "snarkjs";

const PORT = Number(process.env.PROVER_PORT ?? 8790);
const DIR = process.env.CIRCUITS_DIR ?? new URL("./circuits", import.meta.url).pathname;
const TOKEN = (process.env.PROVER_TOKEN ?? "").trim();
if (!TOKEN) throw new Error("PROVER_TOKEN is required");

const sign = (buf) => createHmac("sha256", TOKEN).update(buf).digest("hex");
const ok = (given, raw) => {
  const want = sign(raw);
  return typeof given === "string" && given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
};

const circuits = new Map();
async function loadCircuits() {
  circuits.clear();
  if (!existsSync(DIR)) return;
  for (const name of readdirSync(DIR)) {
    const d = join(DIR, name);
    const wasm = join(d, "circuit.wasm"), zkey = join(d, "circuit.zkey"), map = join(d, "map.mjs");
    if (![wasm, zkey, map].every(existsSync)) continue;
    const mapInput = (await import(pathToFileURL(map).href + `?v=${Date.now()}`)).default;
    circuits.set(name, { wasm, zkey, mapInput, vkey: existsSync(join(d, "vkey.json")) ? JSON.parse(readFileSync(join(d, "vkey.json"), "utf8")) : null });
  }
}
await loadCircuits();

function reply(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { "content-type": "application/json", "x-prover-signature": sign(body) });
  res.end(body);
}

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks);
    if (req.method === "GET" && req.url === "/health") return reply(res, 200, { ok: true, circuits: [...circuits.keys()] });
    if (!ok(req.headers["x-prover-signature"], raw)) return reply(res, 401, { error: "bad signature" });
    let msg;
    try { msg = JSON.parse(raw.toString("utf8")); } catch { return reply(res, 400, { error: "bad json" }); }

    if (req.url === "/reload") { await loadCircuits(); return reply(res, 200, { circuits: [...circuits.keys()] }); }
    if (req.url !== "/prove") return reply(res, 404, { error: "not found" });

    const c = circuits.get(msg.circuit);
    if (!c) return reply(res, 404, { error: `no circuit ${msg.circuit}` });
    const t0 = Date.now();
    try {
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(c.mapInput(msg.payload), c.wasm, c.zkey);
      const verified = c.vkey ? await snarkjs.groth16.verify(c.vkey, publicSignals, proof) : null;
      reply(res, 200, { proof, public_signals: publicSignals, verified, ms: Date.now() - t0 });
    } catch (err) {
      console.error(`prove ${msg.circuit} failed:`, err.message);
      reply(res, 500, { error: "prove failed", ms: Date.now() - t0 });
    }
  });
}).listen(PORT, "127.0.0.1", () => console.log(`prover on 127.0.0.1:${PORT}, circuits: ${[...circuits.keys()].join(", ") || "none"}`));
