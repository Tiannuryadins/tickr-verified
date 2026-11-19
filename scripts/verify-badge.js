#!/usr/bin/env node
// scripts/verify-badge.js — resolve + verify a Verified by Concordium badge.
//
// Live path (no key needed, default): resolves the badge through the hosted
// MCP REST endpoints AND independently re-checks the card hash by fetching
// agent_uri and comparing its SHA-256 to the on-chain metadata_hash. With no
// arguments it verifies the known-good live fixture badge (token 1211),
// proving the verification path against real testnet data.
//
// Mock path (--mode mock --token-id N): verifies the mock-registered agent's
// badge against the local mock chain.

import {
  parseArgs,
  printHelp,
  fail,
  resolveMode,
  getChain,
  loadRegistration,
  printJson,
} from "./lib.js";
import {
  restCheckBadge,
  restVerifyAgentCard,
  restGetBadgeJson,
  liveAgentOf,
  liveAgentByTokenAddress,
  tokenIdToBadge,
  badgeToTokenId,
  LIVE_FIXTURE_BADGE,
  LIVE_FIXTURE_TOKEN_ID,
} from "../src/concordium.js";
import { sha256Hex } from "../src/agent-card.js";

const { flags } = parseArgs(process.argv.slice(2));

if (flags.help) {
  printHelp(
    "verify-badge.js — resolve + verify a Concordium badge.",
    "node scripts/verify-badge.js [--mode mock|testnet] [--badge <badge> | --token-id <id> | --account <addr>] [--json]",
    `  --mode mock|testnet   Chain mode for mock verification (default: mock
                        for --token-id on the mock chain; live REST is used
                        for --badge/--account unless --mode mock is given
                        with --token-id).
  --badge <badge>       Badge short form to verify (default: the live
                        fixture badge ${LIVE_FIXTURE_BADGE}, token ${LIVE_FIXTURE_TOKEN_ID}).
  --token-id <id>       Verify by token id instead.
  --account <addr>      Check every badge owned by a Concordium account.
  --json                Print the verdict as JSON only.`
  );
  process.exit(0);
}

const mode = resolveMode(flags);

// --- Mock path: verify a mock-registered agent against the mock chain ------
if (mode === "mock" && flags["token-id"]) {
  const tokenId = Number(flags["token-id"]);
  const chain = getChain("mock");
  const agent = await chain.agentOf(tokenId);
  if (!agent) fail(`No mock agent with token id ${tokenId}. Run scripts/register.js first.`);
  const badge = await tokenIdToBadge(tokenId);
  const checks = {
    on_chain_agent_found: true,
    status_active: agent.status === "Active",
    has_agent_uri: !!agent.agent_uri,
    has_metadata_hash: !!agent.metadata_hash_hex,
  };
  const verdict = {
    mode: "mock",
    badge,
    tokenId,
    owner: agent.owner_account,
    status: agent.status,
    agentUri: agent.agent_uri,
    metadataHash: agent.metadata_hash_hex,
    checks,
    badge_valid: Object.values(checks).every(Boolean),
    note: "MOCK verification — the agent exists only on the local mock chain.",
  };
  if (flags.json) {
    printJson(verdict);
    process.exit(0);
  }
  console.log("MOCK badge verification");
  console.log(`  badge:  ${badge}`);
  console.log(`  token:  ${tokenId}`);
  console.log(`  owner:  ${agent.owner_account}`);
  console.log(`  status: ${agent.status}`);
  console.log(`  card:   ${agent.agent_uri}`);
  console.log(`  hash:   ${agent.metadata_hash_hex}`);
  console.log(`  verdict: ${verdict.badge_valid ? "VALID (mock)" : "INVALID (mock)"}`);
  process.exit(verdict.badge_valid ? 0 : 1);
}

// --- Live path (REST + independent card-hash re-check) ----------------------
let badge = flags.badge ?? null;
let tokenId = flags["token-id"] ? Number(flags["token-id"]) : null;
const account = flags.account ?? null;

if (account && (badge || tokenId)) {
  fail("Pass only one of --badge, --token-id, --account.");
}

if (account) {
  console.log(`Checking every badge owned by ${account} (live testnet)...`);
  const result = await restCheckBadge(account);
  if (flags.json) {
    printJson(result);
    process.exit(0);
  }
  console.log(`  agent_count: ${result.agent_count}`);
  console.log(`  summary: ${JSON.stringify(result.summary)}`);
  for (const a of result.agents ?? []) {
    console.log(
      `  token ${a.token_id}: ${a.token_address} valid=${a.badge_valid} ` +
        `http=${a.http_status} hash_match=${a.checks?.hash_matches_on_chain}`
    );
  }
  process.exit(0);
}

if (!badge && tokenId === null) {
  badge = LIVE_FIXTURE_BADGE;
  tokenId = LIVE_FIXTURE_TOKEN_ID;
  console.log(
    `No badge given — verifying the live fixture badge ${badge} (token ${tokenId}).`
  );
}
if (!badge && tokenId !== null) {
  const agent = await liveAgentOf(tokenId);
  if (!agent) fail(`No live testnet agent with token id ${tokenId}.`);
  badge = await tokenIdToBadge(tokenId);
  console.log(`Token ${tokenId} resolves to badge ${badge}.`);
}
if (tokenId === null && badge) {
  try {
    tokenId = await badgeToTokenId(badge);
  } catch {
    tokenId = null; // badge may be from another registry; REST still resolves it
  }
}

console.log(`\nVerifying badge ${badge} against live Concordium testnet...`);

// 1. Hosted REST verdict (chain-derived, re-checked below independently).
const check = await restCheckBadge(badge);
const cardVerify = await restVerifyAgentCard(badge);
const badgeJson = await restGetBadgeJson(badge).catch(() => null);

// 2. Independent re-check: fetch agent_uri ourselves, hash it, compare.
let independent = null;
const onChainUri = check.agents?.[0]?.agent_uri ?? check.agent_uri ?? badgeJson?.agent_uri;
const onChainHash =
  check.agents?.[0]?.on_chain?.metadata_hash_hex ??
  check.on_chain?.metadata_hash_hex ??
  cardVerify?.on_chain_hash_hex;
if (onChainUri) {
  try {
    const res = await fetch(onChainUri);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const hash = sha256Hex(bytes);
    independent = {
      agent_uri: onChainUri,
      http_status: res.status,
      fetched_sha256: hash,
      on_chain_sha256: onChainHash ?? null,
      hash_matches: onChainHash ? hash === onChainHash.toLowerCase() : null,
    };
  } catch (err) {
    independent = { agent_uri: onChainUri, fetch_error: err.message };
  }
}

const single = check.agents?.[0] ?? check;
const verdict = {
  mode: "live-testnet",
  badge,
  tokenId: tokenId ?? single.token_id ?? badgeJson?.token_id ?? null,
  owner: single.on_chain?.owner_account ?? badgeJson?.owner_account ?? null,
  status: single.on_chain?.status ?? badgeJson?.status ?? null,
  agentUri: onChainUri ?? null,
  rest_badge_valid: single.badge_valid ?? check.badge_valid ?? null,
  rest_checks: single.checks ?? null,
  rest_issues: single.issues ?? check.issues ?? null,
  card_verify_match: cardVerify?.fetched?.sha256_hex
    ? cardVerify.fetched.sha256_hex === cardVerify.on_chain_hash_hex
    : null,
  independent_card_check: independent,
};

if (flags.json) {
  printJson(verdict);
  process.exit(0);
}

console.log(`  token id:   ${verdict.tokenId}`);
console.log(`  owner:      ${verdict.owner}`);
console.log(`  status:     ${verdict.status}`);
console.log(`  agent_uri:  ${verdict.agentUri}`);
console.log(`  REST verdict: badge_valid=${verdict.rest_badge_valid}`);
if (verdict.rest_checks) {
  for (const [k, v] of Object.entries(verdict.rest_checks)) {
    console.log(`    ${k}: ${v}`);
  }
}
if (verdict.rest_issues?.length) {
  console.log("  issues:");
  for (const i of verdict.rest_issues) {
    console.log(`    [${i.severity}] ${i.field}: ${i.message}`);
  }
}
if (independent) {
  console.log("  independent card check (this script fetched + hashed the card):");
  console.log(`    http_status:  ${independent.http_status ?? independent.fetch_error}`);
  console.log(`    fetched hash: ${independent.fetched_sha256 ?? "-"}`);
  console.log(`    on-chain:     ${independent.on_chain_sha256 ?? "-"}`);
  console.log(`    match:        ${independent.hash_matches}`);
}
const valid =
  verdict.rest_badge_valid === true && independent?.hash_matches !== false;
console.log(`\nVerdict: ${valid ? "VALID badge (live testnet)" : "NOT fully valid — see issues above"}`);
process.exit(valid ? 0 : 1);
