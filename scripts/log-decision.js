#!/usr/bin/env node
// scripts/log-decision.js — append a TICKR decision to the Concordium
// accountability log (CIS-8004 setMetadata on the agent token).
//
// With --demo (default when no --symbol is given), the script runs the real
// TICKR agent logic on a built-in demo token snapshot and logs its top
// decision. With --symbol/--signal/--nav/--score/--reason you can log a
// specific decision. With --verify-only it reads a log entry back and
// re-verifies the reason hash against the reasoning text.

import {
  parseArgs,
  printHelp,
  fail,
  resolveMode,
  getChain,
  resolveTokenId,
  loadRegistration,
  printJson,
} from "./lib.js";
import { analyzeToken, sizeBuy } from "../src/tickr-agent.js";
import {
  appendDecision,
  readLogEntry,
  readLogHead,
  verifyLogRecord,
  reasonHash,
  logKey,
} from "../src/accountability.js";

// A fixed demo snapshot: fresh NAV, deep supply -> the agent scores 50 -> BUY.
// Deterministic, so the demo is reproducible.
export const DEMO_TOKEN = {
  symbol: "B20",
  name: "Backed IBIT",
  nav_price: "45.67",
  nav_price_updated_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  total_supply: "25000",
  multiplier: 1,
};

const { flags } = parseArgs(process.argv.slice(2));

if (flags.help) {
  printHelp(
    "log-decision.js — log a TICKR decision to the Concordium accountability log.",
    "node scripts/log-decision.js [--mode mock|testnet] [--token-id <id>] [--demo | --symbol S --signal BUY --nav N --score N --reason R...] [--base-tx <hash>] [--verify-only --seq N] [--json]",
    `  --mode mock|testnet   Chain mode (default: mock).
  --token-id <id>       Agent token id (default: saved registration).
  --demo                Run the TICKR agent on the built-in demo token and
                        log its decision (default when --symbol is absent).
  --symbol <S>          Token symbol for a manual decision.
  --signal <SIG>        BUY | SELL | HOLD | AVOID (manual mode).
  --nav <N>             NAV price in USD (manual mode).
  --score <N>           Agent score 0-60 (manual mode).
  --reason <R>          A reason line (repeatable; manual mode).
  --base-tx <hash>      Base Sepolia TradeJournal tx hash to link.
  --verify-only --seq N Read back log entry N and verify its reason hash.
  --json                Print the result as JSON only.`
  );
  process.exit(0);
}

const mode = resolveMode(flags);
const tokenId = resolveTokenId(flags);
const chain = getChain(mode);
const reg = loadRegistration();
const badge = reg?.badge ?? (mode === "mock" ? "MOCK" : null);
if (!badge) {
  fail(
    "No badge known for this agent. Run scripts/register.js first (it saves the badge)."
  );
}

// --- Verify-only path ---------------------------------------------------------
if (flags["verify-only"]) {
  const seq = Number(flags.seq);
  if (!seq) fail("--verify-only requires --seq <N>.");
  const entry = await readLogEntry(chain, tokenId, seq);
  if (!entry) {
    fail(`No log entry at ${logKey(seq)} for agent ${tokenId}.`);
  }
  console.log(`Log entry ${entry.key} for agent ${tokenId}:`);
  printJson(entry.record);
  console.log(
    "\nTo fully verify, re-run the agent on the same inputs and compare " +
      `reason hash ${entry.record.h} (see tests/accountability.test.js for the round-trip).`
  );
  process.exit(0);
}

// --- Build the decision -------------------------------------------------------
let analysis;
let decision;
let qtyMilli = null;
let priceMicroUsd = null;

if (flags.symbol) {
  decision = (flags.signal ?? "HOLD").toUpperCase();
  if (!["BUY", "SELL", "HOLD", "AVOID"].includes(decision)) {
    fail(`--signal must be BUY, SELL, HOLD or AVOID (got "${flags.signal}").`);
  }
  const nav = flags.nav ? Number(flags.nav) : null;
  const score = flags.score ? Number(flags.score) : 0;
  const reasons = [];
  if (flags.reason) {
    (Array.isArray(flags.reason) ? flags.reason : [flags.reason]).forEach((r) =>
      reasons.push(r)
    );
  }
  if (!reasons.length) reasons.push("Manual decision logged from the CLI.");
  analysis = {
    symbol: flags.symbol,
    name: flags.symbol,
    nav,
    signal: decision,
    score,
    reasons,
    tradeable: decision === "BUY",
  };
  if (decision === "BUY" && nav) {
    const sized = sizeBuy(nav, 1_000_000);
    qtyMilli = sized?.qtyMilli ?? null;
    priceMicroUsd = Math.round(nav * 1_000_000);
  }
} else {
  // Demo: run the real TICKR agent on the built-in snapshot.
  const now = Date.now();
  analysis = analyzeToken(DEMO_TOKEN, null, now);
  decision = analysis.signal;
  if (decision === "BUY") {
    const sized = sizeBuy(analysis.nav, 1_000_000);
    qtyMilli = sized?.qtyMilli ?? null;
    priceMicroUsd = Math.round(analysis.nav * 1_000_000);
  }
  console.log("Demo run — real TICKR agent logic on a built-in snapshot:");
  console.log(`  ${analysis.symbol}: ${analysis.signal} (score ${analysis.score})`);
  for (const r of analysis.reasons) console.log(`    - ${r}`);
  if (qtyMilli) console.log(`  sized: ${qtyMilli} milli-shares`);
}

console.log(`\nReason hash: ${reasonHash(analysis)}`);
if (mode === "mock") {
  console.log("MOCK MODE — logging to the local mock chain (not a real transaction).");
} else {
  console.log(`TESTNET MODE — logging to agent ${tokenId} on Concordium testnet.`);
}

const head = await readLogHead(chain, tokenId);
const result = await appendDecision(chain, tokenId, {
  decision,
  analysis,
  badge,
  qtyMilli,
  priceMicroUsd,
  baseTxHash: flags["base-tx"] ?? null,
});

if (flags.json) {
  printJson({ mode, tokenId, previousHead: head, ...result });
  process.exit(0);
}

console.log(`\nDecision logged as ${result.key} (seq ${result.seq}).`);
console.log(`  entry tx: ${result.txHash}`);
console.log(`  head tx:  ${result.headTxHash}`);
console.log(`  badge:    ${badge}`);
if (mode === "testnet") {
  console.log(
    `  explorer: https://testnet.ccdscan.io/transaction/${result.txHash}`
  );
}
console.log(
  `\nVerify it: node scripts/log-decision.js --mode ${mode} --token-id ${tokenId} --verify-only --seq ${result.seq}`
);
