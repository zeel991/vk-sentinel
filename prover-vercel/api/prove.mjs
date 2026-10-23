// POST /api/prove  { circuit, payload, allowAlternate }  signed with PROVER_TOKEN (x-prover-signature).
// Same contract as prover/server.mjs, so the Worker talks to either.
import * as snarkjs from "snarkjs";
import { artifacts, available, sign, signatureOk } from "../lib/circuits.mjs";
import mapGatekeeper, { alternate as altGatekeeper } from "../lib/maps/gatekeeper.mjs";
import mapVfy from "../lib/maps/steal-the-vfy.mjs";

export const config = { api: { bodyParser: false } };
const MAPS = { gatekeeper: { map: mapGatekeeper, alternate: altGatekeeper }, "steal-the-vfy": { map: mapVfy, alternate: null } };

function reply(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("x-prover-signature", sign(body));
  res.end(body);
}

async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, { error: "POST only" });
  const raw = await rawBody(req);
  if (!signatureOk(req.headers["x-prover-signature"], raw)) return reply(res, 401, { error: "bad signature" });
  let msg;
  try { msg = JSON.parse(raw.toString("utf8")); } catch { return reply(res, 400, { error: "bad json" }); }
  const entry = MAPS[msg.circuit];
  if (!entry || !available().includes(msg.circuit)) return reply(res, 404, { error: `no circuit ${msg.circuit}` });

  const { wasm, zkey, vkey } = artifacts(msg.circuit);
  const t0 = Date.now();
  // Circuits only prove what their rules allow; Gatekeeper may retry with the other decision.
  const attempts = [msg.payload, ...(entry.alternate && msg.allowAlternate ? [entry.alternate(msg.payload)] : [])];
  for (const [i, payload] of attempts.entries()) {
    try {
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(entry.map(payload), wasm, zkey);
      const verified = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      return reply(res, 200, { proof, public_signals: publicSignals, verified, alternate: i > 0, ms: Date.now() - t0 });
    } catch (err) {
      console.error(`prove ${msg.circuit} attempt ${i} failed:`, String(err?.message).split("\n")[0]);
    }
  }
  reply(res, 422, { error: "not provable", ms: Date.now() - t0 });
}
