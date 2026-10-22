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

CREATE TABLE IF NOT EXISTS vfy_turns (
  match_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  mode TEXT NOT NULL,
  request TEXT NOT NULL,      -- full turn envelope, for replays and disputes
  response TEXT NOT NULL,
  answered_at TEXT NOT NULL,
  PRIMARY KEY (match_id, turn)
);

CREATE TABLE IF NOT EXISTS prover (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  url TEXT NOT NULL,          -- current quick-tunnel URL of the prover box
  circuits TEXT NOT NULL,     -- JSON array of circuit names it can prove
  updated_at TEXT NOT NULL
);
