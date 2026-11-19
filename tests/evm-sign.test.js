// tests/evm-sign.test.js — keccak256 + secp256k1 sign/recover.
//
// The strongest checks here are EXTERNAL vectors, not self-consistency:
//   - keccak256("") and keccak256("hello") match the canonical values.
//   - private key 0x01 derives the well-known Ethereum address
//     0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf (the standard test vector).
// Together they pin the EC math and the hash; the sign->recover round-trip
// then proves the signature path end to end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { keccak256Hex } from "../src/keccak.js";
import {
  privateKeyToAddress,
  privateKeyToPublicKey,
  signHash,
  recoverAddress,
  personalSignDigest,
  signPersonalMessage,
  verifyPersonalSignature,
} from "../src/evm-sign.js";

test("keccak256 matches canonical vectors", () => {
  assert.equal(
    keccak256Hex(""),
    "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
  );
  assert.equal(
    keccak256Hex("hello"),
    "1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"
  );
  // keccak256 != sha3-256 for the same input (different padding)
  assert.notEqual(
    keccak256Hex("hello"),
    "3338be694f50c5c5c300888ac614e6442e6f3388144e4a3d3921929736c5a219"
  );
});

test("private key 0x01 derives the well-known test address", () => {
  const key = "00".repeat(31) + "01";
  // The well-known vector (EIP-55 checksummed form); our function returns
  // lowercase, so compare case-insensitively.
  assert.equal(
    privateKeyToAddress(key).toLowerCase(),
    "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf".toLowerCase()
  );
});

test("public key for 0x01 is the generator point", () => {
  const pub = privateKeyToPublicKey("00".repeat(31) + "01");
  assert.equal(pub[0], 0x04);
  assert.equal(
    Buffer.from(pub.slice(1, 33)).toString("hex"),
    "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
  );
});

test("invalid private keys are rejected", () => {
  assert.throws(() => privateKeyToAddress("00".repeat(32)), /Invalid/);
  assert.throws(
    () => privateKeyToAddress("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
    /Invalid/
  );
});

test("signHash -> recoverAddress round-trips for random keys", () => {
  for (let i = 0; i < 5; i++) {
    const key = randomBytes(32).toString("hex");
    const address = privateKeyToAddress(key);
    const digest = keccak256Hex(`test message ${i}`);
    const { r, s, v } = signHash(digest, key);
    assert.equal(recoverAddress(digest, { r, s, v }).toLowerCase(), address.toLowerCase());
    // low-s enforcement (EIP-2)
    const sBig = BigInt("0x" + s);
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    assert.ok(sBig <= n / 2n, "s must be low");
    assert.ok(v === 0 || v === 1);
  }
});

test("personal-sign digest frames the message correctly", () => {
  // The digest must be keccak256(prefix || message) where the prefix is
  // "\x19Ethereum Signed Message:\n<len>" with the DECIMAL byte length.
  // keccak256 itself is pinned by the canonical vectors above, so this test
  // pins the framing.
  const message = new TextEncoder().encode("hello");
  const prefix = new TextEncoder().encode("\x19Ethereum Signed Message:\n5");
  const framed = new Uint8Array(prefix.length + message.length);
  framed.set(prefix, 0);
  framed.set(message, prefix.length);
  assert.equal(personalSignDigest(message), keccak256Hex(framed));

  // Two-digit length: 12 bytes -> "\n12", not "\n5".
  const long = new TextEncoder().encode("hello world!");
  const prefix12 = new TextEncoder().encode("\x19Ethereum Signed Message:\n12");
  const framed12 = new Uint8Array(prefix12.length + long.length);
  framed12.set(prefix12, 0);
  framed12.set(long, prefix12.length);
  assert.equal(personalSignDigest(long), keccak256Hex(framed12));

  // Deterministic, and sensitive to the message.
  assert.equal(
    personalSignDigest(message),
    personalSignDigest(new TextEncoder().encode("hello"))
  );
  assert.notEqual(
    personalSignDigest(message),
    personalSignDigest(new TextEncoder().encode("helloo"))
  );
});

test("signPersonalMessage + verifyPersonalSignature round-trips", () => {
  const key = randomBytes(32).toString("hex");
  const address = privateKeyToAddress(key);
  const message = new TextEncoder().encode("CIS-8/v1/canonical:test-bytes");
  const { signatureHex, signerAddress, digestHex } = signPersonalMessage(message, key);
  assert.equal(signerAddress.toLowerCase(), address.toLowerCase());
  assert.equal(signatureHex.length, 130); // 65 bytes
  const v = parseInt(signatureHex.slice(128), 16);
  assert.ok(v === 27 || v === 28, "v must be 27/28 in the wire form");
  assert.equal(verifyPersonalSignature(message, signatureHex, address), true);
  // Tampered message fails.
  assert.equal(
    verifyPersonalSignature(new TextEncoder().encode("CIS-8/v1/canonical:OTHER"), signatureHex, address),
    false
  );
  // Wrong address fails.
  assert.equal(
    verifyPersonalSignature(message, signatureHex, "0x0000000000000000000000000000000000000000"),
    false
  );
  // Malformed signature fails (does not throw).
  assert.equal(verifyPersonalSignature(message, "0x1234", address), false);
});

test("CIS-8-style flow: sign canonical bytes, recover the exact deployer-shape address", () => {
  // Simulate the bind.js flow with a throwaway key: canonical bytes ->
  // personal-sign -> the registry would ecrecover this address.
  const key = randomBytes(32).toString("hex");
  const address = privateKeyToAddress(key);
  const canonical = Buffer.from(
    "4349532d382f76312f63616e6f6e6963616c" + "00".repeat(32),
    "hex"
  );
  const { signatureHex } = signPersonalMessage(canonical, key);
  const digest = personalSignDigest(canonical);
  const recovered = recoverAddress(digest, {
    r: signatureHex.slice(0, 64),
    s: signatureHex.slice(64, 128),
    v: parseInt(signatureHex.slice(128), 16) - 27,
  });
  assert.equal(recovered.toLowerCase(), address.toLowerCase());
});
