#!/usr/bin/env bash
# Compiles the self-test circuit and runs a tiny local trusted setup (test only).
set -euo pipefail
cd "$(dirname "$0")"
out=circuits/selftest
mkdir -p "$out" build
~/.local/bin/circom selftest/circuit.circom --r1cs --wasm -o build >/dev/null
cp build/circuit_js/circuit.wasm "$out/circuit.wasm"
cp selftest/map.mjs "$out/map.mjs"
snark=node_modules/.bin/snarkjs
$snark powersoftau new bn128 8 build/pot0.ptau >/dev/null
$snark powersoftau contribute build/pot0.ptau build/pot1.ptau --name=selftest -e="$(head -c 32 /dev/urandom | xxd -p -c 64)" >/dev/null
$snark powersoftau prepare phase2 build/pot1.ptau build/pot.ptau >/dev/null
$snark groth16 setup build/circuit.r1cs build/pot.ptau "$out/circuit.zkey" >/dev/null
$snark zkey export verificationkey "$out/circuit.zkey" "$out/vkey.json" >/dev/null
echo "selftest circuit ready: $(ls $out)"
