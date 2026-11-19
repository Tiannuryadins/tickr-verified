// evm-sign.js — pure-JavaScript secp256k1 signing + recovery for the CIS-8
// external-key proof (ethereum-personal-sign). Zero dependencies; uses only
// node:crypto for randomness and the local keccak256 implementation.
//
// Why hand-rolled: the CIS-8 proof requires the external (EVM) key to sign
// canonical bytes with ethereum-personal-sign, and the signature must carry
// the recovery id (v) so the registry can ecrecover the signer. Node's
// crypto module can do ECDSA but cannot compute a recovery id, and adding a
// full ethers dependency for one signature is overkill. This module is
// verified in tests/evm-sign.test.js: sign -> recover round-trips to the
// address derived from the key, and keccak256 matches canonical vectors.
//
// SECURITY: private keys passed here are testnet-only throwaway keys. This
// module never logs, prints, or persists a key.

import { randomBytes } from "node:crypto";
import { keccak256Hex, keccak256HexOfHex } from "./keccak.js";

// secp256k1 domain parameters
const P =
  0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const Gx =
  0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy =
  0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

function mod(a, m = P) {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modInv(a, m = P) {
  // Extended Euclidean algorithm; a and m must be coprime.
  let [oldR, r] = [mod(a, m), m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return mod(oldS, m);
}

// Point arithmetic on secp256k1. Points are [x, y] or null (infinity).
function pointAdd(p1, p2) {
  if (p1 === null) return p2;
  if (p2 === null) return p1;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  if (x1 === x2 && mod(y1 + y2) === 0n) return null;
  let m;
  if (x1 === x2 && y1 === y2) {
    m = mod((3n * x1 * x1) * modInv(mod(2n * y1)));
  } else {
    m = mod((y2 - y1) * modInv(mod(x2 - x1)));
  }
  const x3 = mod(m * m - x1 - x2);
  const y3 = mod(m * (x1 - x3) - y1);
  return [x3, y3];
}

function scalarMult(k, point = [Gx, Gy]) {
  let result = null;
  let addend = point;
  let n = k;
  while (n > 0n) {
    if (n & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    n >>= 1n;
  }
  return result;
}

function bytesToBigInt(bytes) {
  return BigInt(
    "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  );
}

function bigIntToBytes32(n) {
  const hex = n.toString(16).padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function hexToBytes(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Derive the uncompressed secp256k1 public key (65 bytes, 0x04 || X || Y) from a 32-byte private key. */
export function privateKeyToPublicKey(privateKeyHex) {
  const d = bytesToBigInt(hexToBytes(privateKeyHex));
  if (d <= 0n || d >= N) throw new Error("Invalid secp256k1 private key.");
  const [x, y] = scalarMult(d);
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(bigIntToBytes32(x), 1);
  out.set(bigIntToBytes32(y), 33);
  return out;
}

/** Derive the EVM address (0x + 40 hex chars) from a private key hex string. */
export function privateKeyToAddress(privateKeyHex) {
  const pub = privateKeyToPublicKey(privateKeyHex);
  // Address = last 20 bytes of keccak256(X || Y)
  const hash = keccak256Hex(pub.slice(1));
  return "0x" + hash.slice(-40);
}

/** Derive the EVM address from an uncompressed public key (65 bytes). */
export function publicKeyToAddress(publicKeyBytes) {
  const hash = keccak256Hex(publicKeyBytes.slice(1));
  return "0x" + hash.slice(-40);
}

/**
 * Sign a 32-byte hash with ECDSA/secp256k1 (RFC 6979-style deterministic k is
 * NOT used — k is drawn from crypto.randomBytes; signatures are valid but
 * non-deterministic, which is fine for a one-off proof). Returns
 * { r, s, v } with r/s as 32-byte hex and v as 0 or 1 (the recovery id).
 * Enforces low-s (s <= N/2) per EIP-2.
 */
export function signHash(hashHex, privateKeyHex) {
  const e = bytesToBigInt(hexToBytes(hashHex));
  const d = bytesToBigInt(hexToBytes(privateKeyHex));
  if (d <= 0n || d >= N) throw new Error("Invalid secp256k1 private key.");
  const pub = scalarMult(d);

  for (;;) {
    const k = bytesToBigInt(randomBytes(32));
    if (k <= 0n || k >= N) continue;
    const rPoint = scalarMult(k);
    const r = mod(rPoint[0], N);
    if (r === 0n) continue;
    let s = mod(modInv(k, N) * mod(e + r * d, N), N);
    if (s === 0n) continue;
    // Low-s: flip s and the recovery id if needed.
    let recid = rPoint[1] & 1n ? 1 : 0;
    if (s > N / 2n) {
      s = N - s;
      recid ^= 1;
    }
    // Sanity: recovered key must equal the signer's public key.
    const recovered = recoverPublicKey(e, r, s, recid);
    if (!recovered || recovered[0] !== pub[0] || recovered[1] !== pub[1]) {
      continue; // Extremely unlikely; retry with a fresh k.
    }
    return { r: bytesToHex(bigIntToBytes32(r)), s: bytesToHex(bigIntToBytes32(s)), v: recid };
  }
}

/**
 * Recover the signer's public key point [x, y] from a hash and an (r, s, v)
 * signature. Returns null if recovery is impossible.
 */
export function recoverPublicKey(hashBigInt, r, s, recid) {
  // x = r + (recid >> 1) * N  (recid is 0/1 here, so x = r)
  const x = r;
  if (x >= P) return null;
  // y^2 = x^3 + 7 (mod P); P % 4 == 3 so sqrt is y = (x^3+7)^((P+1)/4).
  const alpha = mod(mod(x * x * x) + 7n);
  let y = modPow(alpha, (P + 1n) / 4n, P);
  if (mod(y * y) !== alpha) return null;
  if ((y & 1n) !== BigInt(recid & 1)) y = P - y;
  const R = [x, y];
  const rInv = modInv(r, N);
  // Q = r^-1 (sR - eG)
  const sR = scalarMult(s, R);
  const eG = scalarMult(hashBigInt);
  const negEG = eG === null ? null : [eG[0], mod(-eG[1])];
  const diff = pointAdd(sR, negEG);
  if (diff === null) return null;
  return scalarMult(rInv, diff);
}

function modPow(base, exp, m) {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = mod(result * b, m);
    b = mod(b * b, m);
    e >>= 1n;
  }
  return result;
}

/** Recover the EVM address (0x...) from a 32-byte hash hex and an (r, s, v) signature. */
export function recoverAddress(hashHex, { r, s, v }) {
  const e = bytesToBigInt(hexToBytes(hashHex));
  const point = recoverPublicKey(e, BigInt("0x" + r), BigInt("0x" + s), v);
  if (!point) throw new Error("ECDSA recovery failed.");
  const pub = new Uint8Array(65);
  pub[0] = 0x04;
  pub.set(bigIntToBytes32(point[0]), 1);
  pub.set(bigIntToBytes32(point[1]), 33);
  return publicKeyToAddress(pub);
}

/** Ethereum personal-sign digest: keccak256("\x19Ethereum Signed Message:\n" + len + message). */
export function personalSignDigest(messageBytes) {
  const prefix = new TextEncoder().encode(
    `\x19Ethereum Signed Message:\n${messageBytes.length}`
  );
  const combined = new Uint8Array(prefix.length + messageBytes.length);
  combined.set(prefix, 0);
  combined.set(messageBytes, prefix.length);
  return keccak256Hex(combined);
}

/**
 * Sign arbitrary bytes with ethereum-personal-sign. Returns the 65-byte
 * signature as a hex string (r || s || v, with v as 27/28 — the form the
 * CIS-8 register proof expects for ethereum-personal-sign) plus the signer
 * address derived from the key (for verification, never for display of the key).
 */
export function signPersonalMessage(messageBytes, privateKeyHex) {
  const digest = personalSignDigest(messageBytes);
  const { r, s, v } = signHash(digest, privateKeyHex);
  const signatureHex = r + s + (27 + v).toString(16).padStart(2, "0");
  return {
    digestHex: digest,
    signatureHex,
    signerAddress: privateKeyToAddress(privateKeyHex),
  };
}

/** Verify a personal-sign signature: recover the signer and compare to the expected address. */
export function verifyPersonalSignature(messageBytes, signatureHex, expectedAddress) {
  const clean = signatureHex.startsWith("0x") ? signatureHex.slice(2) : signatureHex;
  if (clean.length !== 130) return false;
  const r = clean.slice(0, 64);
  const s = clean.slice(64, 128);
  const vByte = parseInt(clean.slice(128, 130), 16);
  const v = vByte >= 27 ? vByte - 27 : vByte;
  try {
    const digest = personalSignDigest(messageBytes);
    const recovered = recoverAddress(digest, { r, s, v });
    return recovered.toLowerCase() === expectedAddress.toLowerCase();
  } catch {
    return false;
  }
}

export { keccak256Hex, keccak256HexOfHex };
