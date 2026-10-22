# Proof Gatekeeper agent — zkVerify Agent Games 2026

A single endpoint that handles preflight and Proof Gatekeeper tasks.

- Checks the HMAC-SHA256 hex signature over the raw request body, and signs every response the same way.
- Applies deterministic checks for all seven task categories: VK substitution, threshold, replay, expiry, recipient, amount overflow, and valid. It fails closed, so any missing or malformed field leads to REJECT.
- Treats `task_id` as an idempotency key, so a retry gets the identical answer.
- Keeps a persistent set of seen `proof_tx` values (`STATE_FILE`) to catch replays across all eight rounds.
- Has an optional Groth16 prover (`src/prover.js`). It stays off until the organisers publish the circuit files.

## Run locally
```bash
npm test
AGENT_GAMES_HMAC_SECRET=dev PORT=8080 npm start   # POST http://localhost:8080/agent
```

## Deploy: Cloudflare Workers free plan (`src/worker.js`)
Workers don't sleep. The replay set and answers are stored in D1, which is free and strongly consistent.
```bash
npx wrangler login
npx wrangler d1 create gatekeeper          # paste the database_id into wrangler.toml
npx wrangler d1 execute gatekeeper --remote --file=schema.sql
npx wrangler deploy                        # -> https://agentgames-gatekeeper.<subdomain>.workers.dev
npx wrangler secret put AGENT_GAMES_HMAC_SECRET
AGENT_URL=https://.../agent AGENT_GAMES_HMAC_SECRET=... node test/smoke.mjs
```
`src/server.js` and the Dockerfile are the Node version, meant for a VM. You need it once Groth16 proving is required, because proving won't fit in the free plan's 10 ms of CPU per request.

## Activate on the platform
1. Register at https://agentgames.zkverify.io/register, then connect GitHub and a wallet.
2. Go to Dashboard → Manage Agents and add an agent. The endpoint is `https://<host>/agent`, including the full path.
3. Click Rotate Secret, copy the secret, then run `npx wrangler secret put AGENT_GAMES_HMAC_SECRET` and paste it in.
4. Run preflight; it has to pass. Enter Proof Gatekeeper from the Events page.
5. Go to Dashboard → Practice and run tasks (up to 10 per hour). Compare the real payloads with `src/decide.js`.

## Env
| var | meaning |
|---|---|
| `AGENT_GAMES_HMAC_SECRET` | from Rotate Secret (required) |
| `STATE_FILE` | replay set + answers, default `./data/state.json` |
| `AGENT_PATH` | default `/agent` |
| `CIRCUIT_WASM`, `CIRCUIT_ZKEY` | Gatekeeper circuit files, once published |
