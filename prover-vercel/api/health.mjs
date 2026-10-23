import { available } from "../lib/circuits.mjs";
export default function handler(req, res) {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, circuits: available() }));
}
