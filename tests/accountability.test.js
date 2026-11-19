// tests/accountability.test.js — the accountability log: schema, reason
// hashing, round-trip, tamper detection, and the mock-chain append flow.

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeToken } from "../src/tickr-agent.js";
import {
  reasonText,
  reasonHash,
  buildLogRecord,
  parseLogRecord,
  verifyLogRecord,
  logKey,
  parseLogKey,
  appendDecision,
  readLogEntry,
  readLogHead,
  HEAD_KEY,
  MAX_LOG_VALUE_BYTES,
} from "../src/accountability.js";
import { MockConcordiumChain } from "../src/concordium.js";
import { buildAgentCard, cardHash } from "../src/agent-card.js";

const NOW = Date.parse("2026-11-19T12:00:00Z");
function analysis(overrides = {}) {
  return analyzeToken(
    {
      symbol: "B20",
      name: "Backed IBIT",
      nav_price: "45.67",
      nav_price_updated_at: new Date(NOW - 20 * 60 * 1000).toISOString(),
      total_supply: "25000",
      multiplier: 1,
      ...overrides,
    },
    null,
    NOW
  );
}

test("log keys are zero-padded and parse back", () => {
  assert.equal(logKey(1), "tickr.log.000001");
  assert.equal(logKey(42), "tickr.log.000042");
  assert.equal(parseLogKey("tickr.log.000042"), 42);
  assert.equal(parseLogKey("tickr.log.head"), null);
  assert.equal(parseLogKey("other.key"), null);
  assert.ok(logKey(1).length <= 64, "key fits the 64-char contract limit");
});

test("reason text is canonical and the hash is a keccak256", () => {
  const a = analysis();
  const text = reasonText(a);
  assert.match(text, /TICKR decision for B20/);
  assert.match(text, /signal: BUY/);
  assert.match(text, /score: 50/);
  const hash = reasonHash(a);
  assert.match(hash, /^0x[0-9a-f]{64}$/);
  assert.equal(hash, reasonHash(analysis())); // deterministic
  assert.notEqual(hash, reasonHash(analysis({ nav_price: "46.00" })));
});

test("buildLogRecord produces a small, parseable record", () => {
  const a = analysis();
  const built = buildLogRecord({
    seq: 1,
    decision: "BUY",
    analysis: a,
    badge: "JyP9XR6EkrzHnx9g177u9",
    qtyMilli: 21896,
    priceMicroUsd: 45_670_000,
    baseTxHash: "0xabc123",
  });
  assert.equal(built.key, "tickr.log.000001");
  assert.equal(built.record.v, 1);
  assert.equal(built.record.d, "BUY");
  assert.equal(built.record.s, "B20");
  assert.equal(built.record.h, reasonHash(a));
  assert.equal(built.record.b, "JyP9XR6EkrzHnx9g177u9");
  assert.equal(built.record.j, "0xabc123");
  assert.ok(Buffer.from(built.valueHex, "hex").length <= MAX_LOG_VALUE_BYTES);
  const parsed = parseLogRecord(built.valueHex);
  assert.deepEqual(parsed, built.record);
  // Parsing the plain JSON text also works.
  assert.deepEqual(parseLogRecord(built.valueJson), built.record);
});

test("buildLogRecord rejects invalid decisions and oversized values", () => {
  const a = analysis();
  assert.throws(
    () => buildLogRecord({ seq: 1, decision: "YOLO", analysis: a, badge: "MOCK" }),
    /Invalid decision/
  );
  // Oversized value: the record stores the symbol verbatim, so a huge
  // symbol blows the 512-byte cap. (Long reason text does NOT — only its
  // 32-byte hash is stored, by design.)
  const hugeSymbol = analysis({ symbol: "S".repeat(600) });
  assert.throws(
    () => buildLogRecord({ seq: 1, decision: "BUY", analysis: hugeSymbol, badge: "MOCK" }),
    /too large/
  );
});

test("verifyLogRecord accepts a matching record and rejects tampering", () => {
  const a = analysis();
  const built = buildLogRecord({ seq: 1, decision: "BUY", analysis: a, badge: "MOCK" });
  const ok = verifyLogRecord(built.record, a, "BUY");
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.issues, []);

  // Tampered reason hash
  const tamperedHash = verifyLogRecord(
    { ...built.record, h: "0x" + "00".repeat(32) },
    a,
    "BUY"
  );
  assert.equal(tamperedHash.ok, false);
  assert.equal(tamperedHash.checks.reason_hash_matches, false);

  // Different analysis (different NAV -> different reasons)
  const other = analysis({ nav_price: "99.99" });
  const mismatched = verifyLogRecord(built.record, other, "BUY");
  assert.equal(mismatched.ok, false);

  // Wrong decision
  const wrongDecision = verifyLogRecord(built.record, a, "SELL");
  assert.equal(wrongDecision.ok, false);
  assert.equal(wrongDecision.checks.decision_matches, false);
});

test("mock-chain append flow: head advances, entries read back and verify", async () => {
  const chain = new MockConcordiumChain();
  const owner = chain.getOwnerAccount();
  const card = buildAgentCard({});
  const { tokenId, badge } = await chain.register({
    sender: owner,
    agentUri: "https://example.invalid/agent-card.json",
    metadataHashHex: cardHash(card),
  });

  assert.equal(await readLogHead(chain, tokenId), 0);
  assert.equal(await readLogEntry(chain, tokenId, 1), null);

  const a1 = analysis();
  const first = await appendDecision(chain, tokenId, {
    decision: "BUY",
    analysis: a1,
    badge,
    qtyMilli: 21896,
    priceMicroUsd: 45_670_000,
  });
  assert.equal(first.seq, 1);
  assert.ok(first.txHash.startsWith("mock-"));
  assert.equal(await readLogHead(chain, tokenId), 1);

  const a2 = analysis({ nav_price: "46.10" });
  const second = await appendDecision(chain, tokenId, {
    decision: "HOLD",
    analysis: a2,
    badge,
  });
  assert.equal(second.seq, 2);
  assert.equal(await readLogHead(chain, tokenId), 2);

  const entry1 = await readLogEntry(chain, tokenId, 1);
  assert.equal(entry1.record.d, "BUY");
  assert.equal(verifyLogRecord(entry1.record, a1, "BUY").ok, true);
  const entry2 = await readLogEntry(chain, tokenId, 2);
  assert.equal(entry2.record.d, "HOLD");
  assert.equal(verifyLogRecord(entry2.record, a2, "HOLD").ok, true);

  // The head pointer is itself a metadata entry.
  const head = await chain.getMetadata(tokenId, HEAD_KEY);
  assert.equal(head.value_text, "000002");
});
