#!/usr/bin/env node
// scripts/pay.js — agent payment demo: an on-chain CCD transfer between two
// agent accounts with an audit-trail record linking the payment to the badge
// and (optionally) to a logged decision.
//
// Directions:
//   pay-for-signal: counterparty pays the agent for a verified signal.
//   decision-fee:   the agent pays a small fee per verified decision.
// In mock mode the counterparty is the built-in mock account; in testnet
// mode --to is required (a real testnet account address).

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
import {
  executePayment,
  formatCcd,
  parseCcd,
  DEFAULT_SIGNAL_PRICE_MICRO_CCD,
  DEFAULT_DECISION_FEE_MICRO_CCD,
} from "../src/payment.js";
import { MOCK_COUNTERPARTY_ACCOUNT } from "../src/concordium.js";

const { flags } = parseArgs(process.argv.slice(2));

if (flags.help) {
  printHelp(
    "pay.js — agent payment demo (CCD transfer + audit record).",
    "node scripts/pay.js [--mode mock|testnet] [--token-id <id>] [--direction pay-for-signal|decision-fee] [--amount <ccd>] [--to <account>] [--decision-seq <n>] [--json]",
    `  --mode mock|testnet   Chain mode (default: mock).
  --token-id <id>       Agent token id (default: saved registration).
  --direction <dir>     pay-for-signal (default) or decision-fee.
  --amount <ccd>        Amount in CCD (default: 1 for pay-for-signal,
                        0.1 for decision-fee).
  --to <account>        Recipient (testnet mode: required for decision-fee;
                        mock mode: defaults to the mock counterparty).
  --decision-seq <n>    Link the payment to accountability log entry n.
  --json                Print the audit record as JSON only.`
  );
  process.exit(0);
}

const mode = resolveMode(flags);
const tokenId = resolveTokenId(flags);
const chain = getChain(mode);
const reg = loadRegistration();
const badge = reg?.badge ?? (mode === "mock" ? "MOCK" : null);
const direction = flags.direction ?? "pay-for-signal";
if (!["pay-for-signal", "decision-fee"].includes(direction)) {
  fail(`--direction must be pay-for-signal or decision-fee (got "${direction}").`);
}

const defaultAmount =
  direction === "pay-for-signal"
    ? DEFAULT_SIGNAL_PRICE_MICRO_CCD
    : DEFAULT_DECISION_FEE_MICRO_CCD;
const amountMicroCcd = flags.amount ? parseCcd(flags.amount) : defaultAmount;
const agent = chain.getOwnerAccount();

let from;
let to;
if (direction === "pay-for-signal") {
  // Counterparty pays the agent.
  from = flags.from ?? (mode === "mock" ? MOCK_COUNTERPARTY_ACCOUNT : null);
  to = flags.to ?? agent;
  if (!from) {
    fail(
      "pay-for-signal in testnet mode needs --from <counterparty account> " +
        "(the payer). In mock mode the mock counterparty is used by default."
    );
  }
} else {
  // Agent pays a fee.
  from = agent;
  to = flags.to ?? (mode === "mock" ? MOCK_COUNTERPARTY_ACCOUNT : null);
  if (!to) {
    fail(
      "decision-fee in testnet mode needs --to <account> (the fee recipient). " +
        "In mock mode the mock counterparty is used by default."
    );
  }
}

if (mode === "mock") {
  console.log("MOCK MODE — no real CCD moves; the audit record is a demo receipt.");
} else {
  console.log(
    `TESTNET MODE — real testnet transfer of ${formatCcd(amountMicroCcd)} ` +
      `from ${from} to ${to}.`
  );
}

const decisionSeq = flags["decision-seq"] ? Number(flags["decision-seq"]) : null;
const audit = await executePayment(chain, {
  direction,
  from,
  to,
  amountMicroCcd,
  decisionSeq,
  badge,
});

if (flags.json) {
  printJson({ tokenId, ...audit });
  process.exit(0);
}

console.log("\nPayment complete.");
console.log(`  direction: ${audit.direction}`);
console.log(`  amount:    ${audit.amount}`);
console.log(`  from:      ${audit.from}`);
console.log(`  to:        ${audit.to}`);
console.log(`  memo:      ${audit.memo}`);
console.log(`  tx hash:   ${audit.txHash}`);
if (audit.explorerUrl) console.log(`  explorer:  ${audit.explorerUrl}`);
console.log(`  mode:      ${audit.mode}${audit.mode === "mock" ? " (demo receipt only)" : ""}`);
