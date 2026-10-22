// Agent Games endpoint: preflight + Proof Gatekeeper.
// Register the FULL path (https://<host>/agent) on the dashboard.
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { decide } from "./decide.js";
import { Store } from "./store.js";
import { prove, proverReady } from "./prover.js";

const PORT = Number(process.env.PORT ?? 8080);
const SECRET = process.env.AGENT_GAMES_HMAC_SECRET ?? "";
const STATE_FILE = process.env.STATE_FILE ?? "./data/state.json";
const PATH = process.env.AGENT_PATH ?? "/agent";
const MAX_BODY = 256 * 1024;

if (!SECRET) console.warn("AGENT_GAMES_HMAC_SECRET is not set: every request will be refused");

const store = new Store(STATE_FILE);

// The platform's secret is shown as text; use it byte-for-byte as the HMAC key.
const sign = (buf) => createHmac("sha256", SECRET).update(buf).digest("hex");

function verifySignature(raw, header) {
  if (!SECRET || typeof header !== "string") return false;
  const given = header.trim().replace(/^sha256=/i, "").toLowerCase();
  const expected = sign(raw);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

function send(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": body.length,
    "x-agent-games-signature": sign(body),
  });
  res.end(body);
}

async function handleGatekeeper(task) {
  const taskId = String(task.task_id ?? "");
  const cached = store.answers.get(taskId);
  if (taskId && cached) return cached; // platform retry: answer exactly the same

  const input = task.input ?? {};
  const proofTx = typeof input.proof_tx === "string" ? input.proof_tx.trim().toLowerCase() : "";
  const verdict = decide(input, (tx) => store.isReplay(tx, taskId));

  // Leave headroom under the 60 s deadline for the network round trip.
  const deadline = Date.parse(task.deadline_at ?? "") || Date.now() + 60_000;
  const budget = Math.max(0, Math.min(deadline - Date.now() - 8_000, 45_000));
  const zk = await prove(input, verdict.decision, budget);

  const response = { decision: verdict.decision, reason_code: verdict.reason_code };
  if (input.proof_tx) response.proof_tx = input.proof_tx;
  if (zk) Object.assign(response, zk);

  store.record(taskId, proofTx, response, task.mode);
  console.log(JSON.stringify({ t: new Date().toISOString(), task_id: taskId, mode: task.mode, ...verdict, proved: Boolean(zk) }));
  return response;
}

const server = createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, prover: proverReady() }));
  }
  if (req.method !== "POST" || req.url.split("?")[0] !== PATH) {
    res.writeHead(404);
    return res.end();
  }

  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY) req.destroy();
    else chunks.push(c);
  });
  req.on("end", async () => {
    const raw = Buffer.concat(chunks);
    if (!verifySignature(raw, req.headers["x-agent-games-signature"])) {
      console.warn("bad signature from", req.socket.remoteAddress);
      return send(res, 401, { error: "invalid signature" });
    }
    let task;
    try {
      task = JSON.parse(raw.toString("utf8"));
    } catch {
      return send(res, 400, { error: "invalid json" });
    }

    try {
      if (task.type === "agent-games.preflight.v1") {
        return send(res, 200, { ok: true, protocolVersion: "v1" });
      }
      if (task.type === "agent-games.proof-gatekeeper.v1") {
        return send(res, 200, await handleGatekeeper(task));
      }
      console.warn("unknown task type", task.type);
      return send(res, 400, { error: "unsupported task type" });
    } catch (err) {
      console.error("handler error:", err);
      // Fail closed: a REJECT costs at most -3, an error or timeout costs -2 and nothing back.
      return send(res, 200, { decision: "REJECT", reason_code: "PROOF_INVALID", proof_tx: task?.input?.proof_tx });
    }
  });
});

server.listen(PORT, () => console.log(`gatekeeper listening on :${PORT}${PATH} (prover ${proverReady() ? "on" : "off"})`));
