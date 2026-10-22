pragma circom 2.0.0;

// Pipeline self-test only: proves knowledge of a, b with a * b = c.
template Multiplier() {
  signal input a;
  signal input b;
  signal output c;
  c <== a * b;
}

component main = Multiplier();
