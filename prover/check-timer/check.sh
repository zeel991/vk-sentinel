#!/usr/bin/env bash
# Hits the Worker's signed /prover/selftest: the Worker asks the serverless prover for a
# sample proof and records the outcome (shown on GET /health). Run every 5 minutes by
# ag-prover-check.timer so the prover stays in use and failures show up quickly.
# Needs ~/.config/ag-prover-check/env with WORKER_URL and PROVER_TOKEN (chmod 600).
set -euo pipefail
. "${AG_CHECK_ENV:-$HOME/.config/ag-prover-check/env}"
# Own history file: the system journal on a busy box can rotate within hours.
LOG="${AG_CHECK_LOG:-$HOME/.local/state/ag-prover-check.log}"
mkdir -p "$(dirname "$LOG")"
note() { echo "$1"; printf '%s %s\n' "$(date -Is)" "$1" >> "$LOG"; tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; }

ts=$(date +%s%3N)
sig=$(printf 'selftest:%s' "$ts" | openssl dgst -sha256 -hmac "$PROVER_TOKEN" -hex | awk '{print $NF}')
out=$(curl -sS -m 40 -H "x-prover-signature: $sig" "$WORKER_URL/prover/selftest?ts=$ts") || { note "check: request failed"; exit 1; }
if echo "$out" | grep -q '"ok":true'; then note "check: ok $(echo "$out" | grep -o '"round_trip_ms":[0-9]*')"; else note "check: PROOF FAILED $out"; exit 1; fi
