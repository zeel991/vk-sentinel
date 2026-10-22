// Keeps a Cloudflare quick tunnel to the local prover open and tells the
// Worker its current URL (quick-tunnel URLs change on every restart).
// Re-registers every 2 minutes so the Worker always holds a fresh URL.
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";

const PORT = Number(process.env.PROVER_PORT ?? 8790);
const TOKEN = (process.env.PROVER_TOKEN ?? "").trim();
const WORKER = process.env.WORKER_URL; // e.g. https://<worker>.workers.dev
const CLOUDFLARED = process.env.CLOUDFLARED ?? "cloudflared";
if (!TOKEN || !WORKER) throw new Error("PROVER_TOKEN and WORKER_URL are required");

let url = null;

async function register() {
  if (!url) return;
  let circuits = [];
  try { circuits = (await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()).circuits; } catch {}
  const body = JSON.stringify({ url, circuits, ts: Date.now() });
  try {
    const r = await fetch(`${WORKER}/prover/register`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-prover-signature": createHmac("sha256", TOKEN).update(body).digest("hex") },
      body,
    });
    console.log(`registered ${url} circuits=[${circuits}] -> ${r.status}`);
  } catch (err) {
    console.error("register failed:", err.message);
  }
}

function start() {
  url = null;
  const cf = spawn(CLOUDFLARED, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${PORT}`], { stdio: ["ignore", "pipe", "pipe"] });
  const scan = (buf) => {
    const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== url) { url = m[0]; setTimeout(register, 3000); }
  };
  cf.stdout.on("data", scan);
  cf.stderr.on("data", scan);
  cf.on("exit", (code) => { console.error(`cloudflared exited (${code}); restarting in 5s`); setTimeout(start, 5000); });
}

start();
setInterval(register, 120_000);
