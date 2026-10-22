CREATE TABLE IF NOT EXISTS proof_refs (
  scope TEXT NOT NULL,        -- 'competition' or 'practice'
  proof_tx TEXT NOT NULL,     -- lowercased
  task_id TEXT NOT NULL,      -- first task that used it
  seen_at TEXT NOT NULL,
  PRIMARY KEY (scope, proof_tx)
);

CREATE TABLE IF NOT EXISTS answers (
  task_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  response TEXT NOT NULL,
  answered_at TEXT NOT NULL
);
