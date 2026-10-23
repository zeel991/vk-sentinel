#!/usr/bin/env bash
# Copies the shared input maps and the official circuit artifacts into this
# project before `vercel deploy`. Artifacts: the four files from
# https://agentgames.zkverify.io/circuits/ plus vkey.json exported from each zkey.
# usage: ./prepare.sh <dir holding gatekeeper.wasm, gatekeeper_final.zkey, vfy-policy.wasm, vfy-policy_final.zkey> <dir holding gatekeeper.json, vfy-policy.json vkeys> [rapidsnark prover binary]
set -euo pipefail
cd "$(dirname "$0")"
src="$1"; vk="$2"
mkdir -p lib/maps circuits/gatekeeper circuits/steal-the-vfy
cp ../prover/maps/gatekeeper.mjs ../prover/maps/steal-the-vfy.mjs lib/maps/
cp "$src/gatekeeper.wasm" circuits/gatekeeper/circuit.wasm
cp "$src/gatekeeper_final.zkey" circuits/gatekeeper/circuit.zkey
cp "$vk/gatekeeper.json" circuits/gatekeeper/vkey.json
cp "$src/vfy-policy.wasm" circuits/steal-the-vfy/circuit.wasm
cp "$src/vfy-policy_final.zkey" circuits/steal-the-vfy/circuit.zkey
cp "$vk/vfy-policy.json" circuits/steal-the-vfy/vkey.json
# iden3 rapidsnark v0.0.8 linux-x86_64 prover (zip sha256 2ec59e3aa5ff498e862d60b3b7abdcd094ea484271750ec1ea14fb7c1305e423)
if [ -n "${3:-}" ]; then mkdir -p bin && cp "$3" bin/rapidsnark && chmod 755 bin/rapidsnark; fi
shasum -a 256 circuits/*/circuit.* bin/rapidsnark 2>/dev/null
