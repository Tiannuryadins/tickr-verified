// accountability.js — the verifiable accountability log.
//
// THE STORY: TICKR's Base Sepolia TradeJournal is public and append-only,
// but UNAUTHENTICATED — anyone can log entries, and nothing proves WHICH
// agent made a decision. The Concordium accountability log fixes that: each
// TICKR decision is anchored as a CIS-8004 metadata entry on the agent's
// own token, so the decision is cryptographically tied to the badge, the
// owner account, and the Agent Card.
//
// METADATA SCHEMA (on-chain, via CIS-8004 setMetadata):
//   key:   "tickr.log.<seq>" — seq is a 6-digit zero-padded sequence number
//          (e.g. tickr.log.000001). Max key length is 64 chars (contract
//          limit); ours are 19. The reserved key "agentWallet" is never used.
//   value: hex-encoded compact JSON (kept <= 512 bytes, the CIS-8 metadata
//          cap, to stay safely inside any contract limit):
//          {
//            "v": 1,              // schema version
//            "d": "BUY",          // decision: BUY | SELL | HOLD | AVOID
//            "s": "B20",          // token symbol
//            "q": 1234,           // quantity in milli-shares (BUY/SELL only)
//            "p": 456700,         // NAV price in micro-USD (cents*10000)
//            "h": "0x...",        // keccak256 of the canonical reasoning text
//            "t": "2026-11-19T..",// ISO timestamp of the decision
//            "b": "JyP9...",      // badge short form (or "MOCK" in mock mode)
//            "j": "0x..." | null  // Base Sepolia TradeJournal tx hash, if logged there
//          }
//   key:   "tickr.log.head" — value is the latest sequence number as ASCII
//          (e.g. "000042"), so a verifier can discover the log tip in one read.
//
// VERIFICATION CHAIN (anyone can run it, no key needed):
//   decision + reasoning text
//     -> keccak256(reasoning) == record.h
//     -> record lives at tickr.log.<seq> on the agent token (get_metadata)
//     -> agent token resolves via badge: owner + Active + card SHA-256
//        == on-chain metadata_hash (check-badge / verify-agent-card)

import { keccak256Hex } from "./keccak.js";

export const LOG_KEY_PREFIX = "tickr.log.";
export const HEAD_KEY = "tickr.log.head";
export const LOG_SCHEMA_VERSION = 1;
export const MAX_LOG_VALUE_BYTES = 512;

export function logKey(seq) {
  return `${LOG_KEY_PREFIX}${String(seq).padStart(6, "0")}`;
}

export function parseLogKey(key) {
  const m = /^tickr\.log\.(\d{6})$/.exec(key);
  return m ? Number(m[1]) : null;
}

/**
 * Canonical reasoning text for a TICKR analysis. This exact text is what
 * gets hashed — the same text is logged to the Base TradeJournal, so one
 * hash anchors the decision on BOTH chains.
 */
export function reasonText(analysis) {
  const lines = [
    `TICKR decision for ${analysis.symbol} (${analysis.name ?? "unknown"})`,
    `signal: ${analysis.signal}`,
    `score: ${analysis.score}`,
    analysis.nav != null ? `nav: ${analysis.nav}` : "nav: none",
    ...(analysis.reasons ?? []),
  ];
  return lines.join("\n");
}

/** keccak256 (0x-prefixed) of the canonical reasoning text. */
export function reasonHash(analysis) {
  return "0x" + keccak256Hex(reasonText(analysis));
}

/**
 * Build a log record for a decision. `decision` is one of the TICKR signals;
 * `analysis` is the analyzeToken() result; `opts` carries badge, seq,
 * quantity/price (for BUY/SELL), base tx hash and timestamp.
 */
export function buildLogRecord({
  seq,
  decision,
  analysis,
  badge,
  qtyMilli = null,
  priceMicroUsd = null,
  baseTxHash = null,
  timestamp = new Date().toISOString(),
}) {
  if (!["BUY", "SELL", "HOLD", "AVOID"].includes(decision)) {
    throw new Error(`Invalid decision "${decision}".`);
  }
  const record = {
    v: LOG_SCHEMA_VERSION,
    d: decision,
    s: analysis.symbol,
    q: qtyMilli,
    p: priceMicroUsd,
    h: reasonHash(analysis),
    t: timestamp,
    b: badge,
    j: baseTxHash,
  };
  const valueJson = JSON.stringify(record);
  const valueBytes = Buffer.from(valueJson, "utf8");
  if (valueBytes.length > MAX_LOG_VALUE_BYTES) {
    throw new Error(
      `Log record too large: ${valueBytes.length} bytes (max ${MAX_LOG_VALUE_BYTES}).`
    );
  }
  return {
    seq,
    key: logKey(seq),
    record,
    valueJson,
    valueHex: valueBytes.toString("hex"),
  };
}

/** Parse a stored log value (hex or UTF-8 text) back into a record object. */
export function parseLogRecord(valueHexOrText) {
  let text = valueHexOrText;
  if (/^[0-9a-fA-F]+$/.test(valueHexOrText) && valueHexOrText.length % 2 === 0) {
    try {
      text = Buffer.from(valueHexOrText, "hex").toString("utf8");
    } catch {
      // fall through and try parsing as text
    }
  }
  const record = JSON.parse(text);
  if (record.v !== LOG_SCHEMA_VERSION) {
    throw new Error(`Unsupported log schema version ${record.v}.`);
  }
  return record;
}

/**
 * Verify a log record against a TICKR analysis: the reason hash must match
 * the recomputed hash of the analysis's reasoning text, and the decision and
 * symbol must agree. Returns { ok, checks, issues }.
 */
export function verifyLogRecord(record, analysis, expectedDecision = null) {
  const checks = {};
  const issues = [];
  const expectedHash = reasonHash(analysis);
  checks.reason_hash_matches =
    record.h?.toLowerCase() === expectedHash.toLowerCase();
  if (!checks.reason_hash_matches) {
    issues.push(
      `reason hash mismatch: record has ${record.h}, recomputed ${expectedHash}`
    );
  }
  checks.symbol_matches = record.s === analysis.symbol;
  if (!checks.symbol_matches) {
    issues.push(`symbol mismatch: record ${record.s} vs analysis ${analysis.symbol}`);
  }
  if (expectedDecision !== null) {
    checks.decision_matches = record.d === expectedDecision;
    if (!checks.decision_matches) {
      issues.push(
        `decision mismatch: record ${record.d} vs expected ${expectedDecision}`
      );
    }
  }
  checks.schema_version = record.v === LOG_SCHEMA_VERSION;
  if (!checks.schema_version) issues.push(`bad schema version ${record.v}`);
  return { ok: Object.values(checks).every(Boolean), checks, issues };
}

/**
 * Read the log tip (latest seq) from a chain. Returns 0 when the log is empty.
 */
export async function readLogHead(chain, tokenId) {
  const entry = await chain.getMetadata(tokenId, HEAD_KEY);
  if (!entry) return 0;
  const text = entry.value_text ?? Buffer.from(entry.value_hex, "hex").toString("utf8");
  const seq = parseInt(text, 10);
  return Number.isNaN(seq) ? 0 : seq;
}

/**
 * Append one decision to the on-chain log: writes tickr.log.<seq> then
 * advances tickr.log.head. Returns the built record + tx hashes.
 */
export async function appendDecision(chain, tokenId, { decision, analysis, badge, qtyMilli, priceMicroUsd, baseTxHash }) {
  const sender = chain.getOwnerAccount();
  const head = await readLogHead(chain, tokenId);
  const seq = head + 1;
  const built = buildLogRecord({
    seq,
    decision,
    analysis,
    badge,
    qtyMilli,
    priceMicroUsd,
    baseTxHash,
  });
  const { txHash } = await chain.setMetadata(tokenId, {
    sender,
    key: built.key,
    valueHex: built.valueHex,
  });
  const headHex = Buffer.from(String(seq).padStart(6, "0"), "utf8").toString("hex");
  const { txHash: headTxHash } = await chain.setMetadata(tokenId, {
    sender,
    key: HEAD_KEY,
    valueHex: headHex,
  });
  return { ...built, txHash, headTxHash };
}

/** Read back one log entry from a chain and parse it. Returns null when absent. */
export async function readLogEntry(chain, tokenId, seq) {
  const entry = await chain.getMetadata(tokenId, logKey(seq));
  if (!entry) return null;
  const valueHex = entry.value_hex;
  return { seq, key: logKey(seq), record: parseLogRecord(valueHex), valueHex };
}
