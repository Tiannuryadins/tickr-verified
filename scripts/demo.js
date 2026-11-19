#!/usr/bin/env node
// scripts/demo.js — full end-to-end TICKR Verified flow in MOCK mode:
//   register -> bind (in-memory throwaway EVM key) -> log 2 decisions ->
//   pay for a signal -> verify the badge.
// No network, no keys, no real transactions. The same flow runs against
// testnet with the individual scripts once a testnet account exists.

import { randomBytes } from "node:crypto";
import { MockConcordiumChain, MOCK_COUNTERPARTY_ACCOUNT } from "../src/concordium.js";
import { buildAgentCard, cardToBytes, cardHash } from "../src/agent-card.js";
import { analyzeToken, sizeBuy } from "../src/tickr-agent.js";
import { appendDecision, readLogEntry, verifyLogRecord } from "../src/accountability.js";
import { executePayment, formatCcd } from "../src/payment.js";
import { privateKeyToAddress, signPersonalMessage } from "../src/evm-sign.js";

// Same demo snapshot as scripts/log-decision.js (kept in sync deliberately;
// log-decision.js is a CLI and cannot be imported).
const DEMO_TOKEN = {
  symbol: "B20",
  name: "Backed IBIT",
  nav_price: "45.67",
  nav_price_updated_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  total_supply: "25000",
  multiplier: 1,
};

const chain = new MockConcordiumChain();
const owner = chain.getOwnerAccount();

console.log("TICKR Verified — end-to-end demo (MOCK MODE)\n");

// 1. Agent Card + registration
const preCard = buildAgentCard({});
const preHash = cardHash(preCard);
console.log("[1] Agent Card built (pre-registration, tokenAddress: null).");
console.log(`    card SHA-256: ${preHash}`);
const { tokenId, badge, txHash } = await chain.register({
  sender: owner,
  agentUri: "https://tiannuryadins.github.io/tickr-verified/agent-card.json",
  metadataHashHex: preHash,
});
console.log(`    registered: token ${tokenId}, badge ${badge}, tx ${txHash}`);
const badgedCard = buildAgentCard({ ownerAccount: owner, tokenId, badge, agentWallet: owner });
const badgedHash = cardHash(badgedCard);
await chain.setAgentUri(tokenId, {
  sender: owner,
  agentUri: "https://tiannuryadins.github.io/tickr-verified/agent-card.json",
  metadataHashHex: badgedHash,
});
console.log(`    card rebuilt with badge + re-pinned (new SHA-256: ${badgedHash.slice(0, 16)}…)`);

// 2. CIS-8 binding (in-memory throwaway EVM key — mock only, never persisted)
const evmKey = randomBytes(32).toString("hex");
const evmAddress = privateKeyToAddress(evmKey);
const canonical = Buffer.from(`CIS-8/v1/canonical:mock-demo:${owner}:${evmAddress}`, "utf8");
const { signatureHex } = signPersonalMessage(canonical, evmKey);
const externalKey = {
  namespace: "eip155:84532",
  key_type: "secp256k1-uncompressed",
  public_key_hex: evmAddress.slice(2).toLowerCase(),
};
const cis8 = await chain.cis8Register({
  sender: owner,
  externalKey,
  proof: { scheme: "ethereum-personal-sign", signature_hex: signatureHex },
});
await chain.setExternalReference(tokenId, {
  sender: owner,
  externalReference: {
    contract_address: { index: 12801, subindex: 0 },
    kind: "Cis8",
    key: externalKey,
  },
});
console.log(`\n[2] CIS-8 binding: Concordium ${owner.slice(0, 20)}… <-> EVM ${evmAddress}`);
console.log(`    binding tx: ${cis8.txHash}; external_reference attached to agent ${tokenId}.`);

// 3. Log two decisions
console.log("\n[3] Accountability log:");
const analyses = [];
for (let i = 0; i < 2; i++) {
  const token = { ...DEMO_TOKEN, nav_price: (45.67 + i * 0.5).toFixed(2) };
  const analysis = analyzeToken(token, i ? { nav: 45.67 } : null);
  analyses.push(analysis);
  const sized = analysis.signal === "BUY" ? sizeBuy(analysis.nav, 1_000_000) : null;
  const logged = await appendDecision(chain, tokenId, {
    decision: analysis.signal,
    analysis,
    badge,
    qtyMilli: sized?.qtyMilli ?? null,
    priceMicroUsd: analysis.nav ? Math.round(analysis.nav * 1_000_000) : null,
  });
  console.log(
    `    ${logged.key}: ${analysis.symbol} ${analysis.signal} ` +
      `(score ${analysis.score}, reason hash ${logged.record.h.slice(0, 18)}…), tx ${logged.txHash}`
  );
}
const entry = await readLogEntry(chain, tokenId, 1);
const check = verifyLogRecord(entry.record, analyses[0], analyses[0].signal);
console.log(`    read-back + verify of entry 1: ok=${check.ok}`);

// 4. Payment: counterparty pays 1 CCD for the verified signal
const audit = await executePayment(chain, {
  direction: "pay-for-signal",
  from: MOCK_COUNTERPARTY_ACCOUNT,
  to: owner,
  amountMicroCcd: 1_000_000n,
  decisionSeq: 1,
  badge,
});
console.log(`\n[4] Payment: ${audit.amount} from counterparty to agent for signal #1.`);
console.log(`    memo: ${audit.memo}; tx: ${audit.txHash}`);

// 5. Badge verification (mock chain)
const agent = await chain.agentOf(tokenId);
console.log(`\n[5] Badge verification (mock chain):`);
console.log(`    badge:  ${badge}`);
console.log(`    owner:  ${agent.owner_account}`);
console.log(`    status: ${agent.status}`);
console.log(`    card:   ${agent.agent_uri}`);
console.log(`    hash:   ${agent.metadata_hash_hex}`);
console.log(`    metadata keys: ${agent.metadata_keys.join(", ")}`);
console.log(`    external_reference: ${JSON.stringify(agent.external_reference)}`);

console.log("\nDemo complete — all steps ran in mock mode (no real transactions).");
console.log("Balances:");
console.log(`  agent:        ${formatCcd(chain.getBalance(owner))}`);
console.log(`  counterparty: ${formatCcd(chain.getBalance(MOCK_COUNTERPARTY_ACCOUNT))}`);
