// keccak.js — pure-JavaScript Keccak-256 (the original Keccak padding, NOT
// NIST SHA3-256). Zero dependencies.
//
// Why hand-rolled: Node's crypto module has sha3-256 but not Keccak-256, and
// both the TICKR Base journal (reason hashes) and Ethereum personal-sign
// (CIS-8 proof) need Keccak-256. This implementation is the standard
// Keccak-f[1600] sponge with rate 1088, verified against the canonical test
// vectors in tests/evm-sign.test.js:
//   keccak256("")      = c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
//   keccak256("hello") = 1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const RHO = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

// Pi permutation: for source lane t (1..24) at (x, y) = (t % 5, floor(t/5)),
// the destination lane is y + 5 * ((2x + 3y) mod 5) — i.e. B[y, (2x+3y)%5].
// Computed from the spec formula, not copied from a table.
const PI = [
  10, 20, 5, 15, 16, 1, 11, 21, 6, 7, 17, 2, 12, 22, 23, 8, 18, 3, 13, 14, 24,
  9, 19, 4,
];

const MASK64 = (1n << 64n) - 1n;

function rotl64(x, n) {
  if (n === 0) return x;
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK64;
}

function keccakF1600(state) {
  for (let round = 0; round < 24; round++) {
    // Theta
    const c = new Array(5);
    for (let x = 0; x < 5; x++) {
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) state[x + y] ^= d;
    }
    // Rho + Pi
    const b = new Array(25);
    b[0] = state[0];
    for (let i = 0; i < 24; i++) {
      b[PI[i]] = rotl64(state[i + 1], RHO[i + 1]);
    }
    // Chi
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        state[y + x] =
          b[y + x] ^ (~b[y + ((x + 1) % 5)] & b[y + ((x + 2) % 5)]);
      }
    }
    // Iota
    state[0] ^= RC[round];
  }
}

/** Keccak-256 of a Uint8Array (or string, UTF-8 encoded). Returns a hex string (no 0x prefix). */
export function keccak256Hex(input) {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  const rate = 136; // bytes (1088 bits)
  const state = new Array(25).fill(0n);

  const absorb = (block, offset, length) => {
    for (let i = 0; i < length; i++) {
      const lane = Math.floor(i / 8);
      const shift = BigInt((i % 8) * 8);
      state[lane] ^= BigInt(block[offset + i]) << shift;
    }
  };

  let offset = 0;
  while (offset + rate <= bytes.length) {
    absorb(bytes, offset, rate);
    keccakF1600(state);
    offset += rate;
  }

  // Final block with Keccak padding (0x01 ... 0x80)
  const remaining = bytes.length - offset;
  const finalBlock = new Uint8Array(rate);
  finalBlock.set(bytes.subarray(offset), 0);
  finalBlock[remaining] ^= 0x01;
  finalBlock[rate - 1] ^= 0x80;
  absorb(finalBlock, 0, rate);
  keccakF1600(state);

  // Squeeze 32 bytes
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const lane = Math.floor(i / 8);
    const shift = BigInt((i % 8) * 8);
    out[i] = Number((state[lane] >> shift) & 0xffn);
  }
  return Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Keccak-256 of a hex string (without 0x). Returns a hex string (no 0x prefix). */
export function keccak256HexOfHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return keccak256Hex(bytes);
}
