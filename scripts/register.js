#!/usr/bin/env node
// scripts/register.js — register the TICKR agent in the CIS-8004 Agent
// Registry (testnet <12802, 0>) and mint its Verified by Concordium badge.
//
// Flow: hash the Agent Card file bytes (SHA-256) -> register(agent_uri,
// metadata_hash) -> the agent NFT is minted and the badge string is the
// token address. In mock mode the whole flow runs against the local mock
// chain; in testnet mode it submits a REAL testnet transaction (needs
// CONCORDIUM_KEY_FILE; fails cleanly without it).
//
// After a real registration, re-run the card build with the badge and pin
// the new hash with setAgentURI (see STATUS.md § Unblock step).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseArgs,
  printHelp,
  fail,
  resolveMode,
  getChain,
  saveRegistration,
  printJson,
  PROJECT_ROOT,
} from "./lib.js";
import { sha256Hex } from "../src/agent-card.js";
import { AGENT_CARD_URL } from "../src/agent-card.js";
import { TESTNET_EXPLORER } from "../src/concordium.js";

const { flags } = parseArgs(process.argv.slice(2));

if (flags.help) {
  printHelp(
    "register.js — register TICKR in the CIS-8004 Agent Registry.",
    "node scripts/register.js [--mode mock|testnet] [--card <path>] [--agent-uri <url>] [--reset] [--pin-only --token-id <id>] [--json]",
    `  --mode mock|testnet   Chain mode (default: mock).
  --card <path>         Agent Card JSON to hash + pin (default: ./agent-card.json).
  --agent-uri <url>     Public URL of the hosted card (default: ${AGENT_CARD_URL}).
  --reset               Reset the mock chain state before registering (mock only).
  --pin-only            Don't register; just re-pin the card hash for an
                        existing agent via setAgentURI (use after rebuilding
                        the card with the real badge). Requires --token-id.
  --json                Print the result as JSON only.`
  );
  process.exit(0);
}

const mode = resolveMode(flags);
const cardPath = flags.card ?? join(PROJECT_ROOT, "agent-card.json");
const agentUri = flags["agent-uri"] ?? AGENT_CARD_URL;

if (!existsSync(cardPath)) {
  fail(`Agent Card file not found: ${cardPath}`);
}
const cardBytes = readFileSync(cardPath);
const metadataHashHex = sha256Hex(cardBytes);

const chain = getChain(mode);
if (flags.reset) {
  if (mode !== "mock") fail("--reset only applies to mock mode.");
  chain.reset();
  console.log("Mock chain state reset.");
}

const owner = chain.getOwnerAccount();
if (mode === "mock") {
  console.log("MOCK MODE — no real transaction will be submitted.");
} else {
  console.log(`TESTNET MODE — registering as ${owner} on Concordium testnet.`);
}
console.log(`Agent Card: ${cardPath}`);
console.log(`agent_uri:  ${agentUri}`);
console.log(`SHA-256:    ${metadataHashHex}`);

// --pin-only: re-pin the (rebuilt, badged) card hash on an existing agent.
if (flags["pin-only"]) {
  const tokenId = flags["token-id"] ? Number(flags["token-id"]) : null;
  if (tokenId === null || Number.isNaN(tokenId)) {
    fail("--pin-only requires --token-id <id>.");
  }
  console.log(`\nPinning new card hash on agent ${tokenId} via setAgentURI...`);
  const pinned = await chain.setAgentUri(tokenId, {
    sender: owner,
    agentUri,
    metadataHashHex,
  });
  console.log(`Done. tx hash: ${pinned.txHash}`);
  if (flags.json) printJson({ mode, tokenId, txHash: pinned.txHash, metadataHashHex, agentUri });
  process.exit(0);
}

const result = await chain.register({
  sender: owner,
  agentUri,
  metadataHashHex,
});

saveRegistration({
  mode,
  tokenId: result.tokenId,
  badge: result.badge,
  txHash: result.txHash,
  agentUri,
  metadataHashHex,
  owner,
  at: new Date().toISOString(),
});

if (flags.json) {
  printJson({ mode, ...result, agentUri, metadataHashHex });
  process.exit(0);
}

console.log("\nRegistered!");
console.log(`  token id: ${result.tokenId}`);
console.log(`  badge:    ${result.badge}`);
console.log(`  tx hash:  ${result.txHash}`);
if (mode === "testnet") {
  console.log(`  explorer: ${TESTNET_EXPLORER}/transaction/${result.txHash}`);
  console.log(`  agent:    ${TESTNET_EXPLORER}/contract/12802/0 (token ${result.tokenId})`);
  console.log("\nNext steps:");
  console.log("  1. Rebuild agent-card.json with this badge (node scripts/build-card.js — see README)");
  console.log("     or run the MCP build_agent_badge tool on the hosted card.");
  console.log("  2. Re-host the card, hash the SERVED bytes, and pin with setAgentURI:");
  console.log("     node scripts/register.js --mode testnet --pin-only --token-id " + result.tokenId);
  console.log("  3. Verify: node scripts/verify-badge.js --badge " + result.badge);
} else {
  console.log("\n(MOCK badge — for demo/testing only. Run with --mode testnet for a real badge.)");
  console.log(`Verify it: node scripts/verify-badge.js --mode mock --token-id ${result.tokenId}`);
}
console.log("\nRegistration saved to .tickr-registration.json");
