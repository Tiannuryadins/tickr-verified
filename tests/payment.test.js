// tests/payment.test.js — agent payment demo: amounts, memos, audit records,
// and execution against the mock chain.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatCcd,
  parseCcd,
  paymentMemo,
  buildAuditRecord,
  executePayment,
  DEFAULT_SIGNAL_PRICE_MICRO_CCD,
  DEFAULT_DECISION_FEE_MICRO_CCD,
} from "../src/payment.js";
import {
  MockConcordiumChain,
  MOCK_OWNER_ACCOUNT,
  MOCK_COUNTERPARTY_ACCOUNT,
} from "../src/concordium.js";

test("formatCcd renders whole and fractional amounts", () => {
  assert.equal(formatCcd(0n), "0 CCD");
  assert.equal(formatCcd(1_000_000n), "1 CCD");
  assert.equal(formatCcd(1_500_000n), "1.5 CCD");
  assert.equal(formatCcd(100_000n), "0.1 CCD");
  assert.equal(formatCcd(1n), "0.000001 CCD");
});

test("parseCcd parses and validates", () => {
  assert.equal(parseCcd("1"), 1_000_000n);
  assert.equal(parseCcd("0.5"), 500_000n);
  assert.equal(parseCcd("0.000001"), 1n);
  assert.throws(() => parseCcd("abc"), /Invalid CCD amount/);
  assert.throws(() => parseCcd("-1"), /Invalid CCD amount/);
  assert.throws(() => parseCcd("1.1234567"), /Invalid CCD amount/); // >6 decimals
  assert.equal(parseCcd("1.5"), 1_500_000n);
});

test("paymentMemo is short, ASCII, and carries the audit reference", () => {
  const memo = paymentMemo({
    kind: "pay-for-signal",
    decisionSeq: 1,
    badge: "JyP9XR6EkrzHnx9g177u9",
  });
  assert.equal(memo, "tickr:pay-for-signal;seq:000001;badge:JyP9XR6EkrzHnx9g177u9");
  assert.ok(Buffer.from(memo, "utf8").length <= 256);
  assert.equal(paymentMemo({ kind: "decision-fee" }), "tickr:decision-fee");
});

test("defaults: 1 CCD per signal, 0.1 CCD per decision fee", () => {
  assert.equal(DEFAULT_SIGNAL_PRICE_MICRO_CCD, 1_000_000n);
  assert.equal(DEFAULT_DECISION_FEE_MICRO_CCD, 100_000n);
});

test("audit record links payment to badge + decision; mock has no explorer URL", () => {
  const audit = buildAuditRecord({
    direction: "pay-for-signal",
    from: MOCK_COUNTERPARTY_ACCOUNT,
    to: MOCK_OWNER_ACCOUNT,
    amountMicroCcd: 1_000_000n,
    memo: "tickr:pay-for-signal;seq:000001",
    decisionSeq: 1,
    badge: "JyP9WvKdLrfKq3NvoaBAZ",
    txHash: "mock-abc",
    mode: "mock",
    at: "2026-11-19T12:00:00.000Z",
  });
  assert.equal(audit.kind, "tickr-payment");
  assert.equal(audit.amount, "1 CCD");
  assert.equal(audit.explorerUrl, null); // mock payments are not on any explorer
  const live = buildAuditRecord({ ...audit, mode: "testnet", txHash: "deadbeef" });
  assert.equal(
    live.explorerUrl,
    "https://testnet.ccdscan.io/transaction/deadbeef"
  );
});

test("executePayment pay-for-signal moves CCD counterparty -> agent", async () => {
  const chain = new MockConcordiumChain();
  const beforeAgent = chain.getBalance(MOCK_OWNER_ACCOUNT);
  const beforeCounter = chain.getBalance(MOCK_COUNTERPARTY_ACCOUNT);
  const audit = await executePayment(chain, {
    direction: "pay-for-signal",
    from: MOCK_COUNTERPARTY_ACCOUNT,
    to: MOCK_OWNER_ACCOUNT,
    amountMicroCcd: 1_000_000n,
    decisionSeq: 1,
    badge: "JyP9WvKdLrfKq3NvoaBAZ",
  });
  assert.equal(audit.direction, "pay-for-signal");
  assert.equal(audit.mode, "mock");
  assert.equal(chain.getBalance(MOCK_OWNER_ACCOUNT), beforeAgent + 1_000_000n);
  assert.equal(chain.getBalance(MOCK_COUNTERPARTY_ACCOUNT), beforeCounter - 1_000_000n);
});

test("executePayment decision-fee moves CCD agent -> counterparty", async () => {
  const chain = new MockConcordiumChain();
  const before = chain.getBalance(MOCK_OWNER_ACCOUNT);
  const audit = await executePayment(chain, {
    direction: "decision-fee",
    from: MOCK_OWNER_ACCOUNT,
    to: MOCK_COUNTERPARTY_ACCOUNT,
    amountMicroCcd: 100_000n,
    decisionSeq: 2,
    badge: "JyP9WvKdLrfKq3NvoaBAZ",
  });
  assert.equal(audit.amount, "0.1 CCD");
  assert.equal(chain.getBalance(MOCK_OWNER_ACCOUNT), before - 100_000n);
  assert.match(audit.memo, /tickr:decision-fee;seq:000002/);
});

test("executePayment rejects invalid directions and impossible amounts", async () => {
  const chain = new MockConcordiumChain();
  await assert.rejects(
    executePayment(chain, {
      direction: "bribe",
      from: MOCK_OWNER_ACCOUNT,
      to: MOCK_COUNTERPARTY_ACCOUNT,
      amountMicroCcd: 1n,
    }),
    /Invalid payment direction/
  );
  await assert.rejects(
    executePayment(chain, {
      direction: "decision-fee",
      from: MOCK_OWNER_ACCOUNT,
      to: MOCK_COUNTERPARTY_ACCOUNT,
      amountMicroCcd: 10n ** 30n,
    }),
    /insufficient balance/
  );
});
