// Persistent memory of proof_tx references and answered tasks.
// Survives restarts as long as STATE_FILE sits on a persistent disk.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class Store {
  constructor(file) {
    this.file = file;
    this.proofTx = new Map(); // proof_tx -> first task_id that used it
    this.answers = new Map(); // task_id -> response object (idempotent retries)
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      for (const [k, v] of Object.entries(data.proofTx ?? {})) this.proofTx.set(k, v);
      for (const [k, v] of Object.entries(data.answers ?? {})) this.answers.set(k, v);
    } catch {
      // first run
    }
  }

  isReplay(proofTx, taskId) {
    const owner = this.proofTx.get(proofTx);
    return owner !== undefined && owner !== taskId;
  }

  record(taskId, proofTx, response, mode) {
    // Practice tasks may reuse references that show up again in scored rounds,
    // so only competition tasks feed the replay set.
    if (proofTx && mode !== "practice" && !this.proofTx.has(proofTx)) this.proofTx.set(proofTx, taskId);
    this.answers.set(taskId, response);
    this.flush();
  }

  flush() {
    const tmp = `${this.file}.tmp`;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(tmp, JSON.stringify({
      proofTx: Object.fromEntries(this.proofTx),
      answers: Object.fromEntries(this.answers),
    }));
    renameSync(tmp, this.file);
  }
}
