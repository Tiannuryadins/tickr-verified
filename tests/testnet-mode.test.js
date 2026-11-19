// tests/testnet-mode.test.js — testnet mode must FAIL CLEANLY without a key:
// no obscure crash, no fake submission, and a clear pointer to the unblock
// step. (With a real key present these tests still pass — they only assert
// the no-key behaviour when CONCORDIUM_KEY_FILE is unset.)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createChain,
  loadTestnetAccount,
  TestnetKeyMissingError,
} from "../src/concordium.js";

test("testnet mode without CONCORDIUM_KEY_FILE fails cleanly", () => {
  if (process.env.CONCORDIUM_KEY_FILE) {
    // A key IS configured in this environment; the fail-clean path does not
    // apply. (In CI / on a fresh machine it will be unset.)
    return;
  }
  assert.throws(() => loadTestnetAccount(), TestnetKeyMissingError);
  assert.throws(() => loadTestnetAccount(), /testnet key not configured/);
  assert.throws(() => loadTestnetAccount(), /STATUS\.md/);
  assert.throws(() => createChain("testnet"), TestnetKeyMissingError);
});

test("testnet mode with a nonexistent key file fails cleanly", () => {
  const prev = process.env.CONCORDIUM_KEY_FILE;
  process.env.CONCORDIUM_KEY_FILE = "/nonexistent/path/testnet-account.export";
  try {
    assert.throws(() => createChain("testnet"), TestnetKeyMissingError);
  } finally {
    if (prev === undefined) delete process.env.CONCORDIUM_KEY_FILE;
    else process.env.CONCORDIUM_KEY_FILE = prev;
  }
});

test("unknown chain mode is rejected", () => {
  assert.throws(() => createChain("mainnet"), /Unknown chain mode/);
  assert.throws(() => createChain(""), /Unknown chain mode/);
});

test("mock mode needs no key and no network", () => {
  const chain = createChain("mock");
  assert.equal(chain.mode, "mock");
});
