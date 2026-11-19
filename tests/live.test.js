// tests/live.test.js — LIVE testnet reads against the real Concordium
// testnet (no key needed). Each test SKIPS gracefully if the network is
// unreachable, so `npm test` stays green offline — but when the network is
// up, these prove the verification path against real chain data.
//
// Fixture: token 1211 / badge JyP9XR6EkrzHnx9g177u9, a real registered
// testnet agent (another builder's demo) whose badge verified as fully
// valid on 19 Nov 2026. We only READ it.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  liveNetworkStatus,
  liveContractInfo,
  liveListAgents,
  liveAgentOf,
  restCheckBadge,
  restVerifyAgentCard,
  restGetBadgeJson,
  LIVE_FIXTURE_BADGE,
  LIVE_FIXTURE_TOKEN_ID,
} from "../src/concordium.js";
import { sha256Hex } from "../src/agent-card.js";

/** Run a live check; skip the test (don't fail) when the network is unreachable. */
async function liveOrSkip(t, fn) {
  try {
    return await fn();
  } catch (err) {
    t.skip(`live testnet unreachable: ${err.message}`);
    return null;
  }
}

test("live: testnet is up and current", async (t) => {
  const status = await liveOrSkip(t, liveNetworkStatus);
  if (!status) return;
  assert.equal(status.network, "testnet");
  assert.ok(status.latest_block_height > 51_000_000, "chain height is current");
  assert.match(status.latest_block_hash, /^[0-9a-f]{64}$/);
});

test("live: registry contracts are <12802,0> and <12801,0>", async (t) => {
  const info = await liveOrSkip(t, liveContractInfo);
  if (!info) return;
  assert.deepEqual(info.cis8004_contract, { index: 12802, subindex: 0 });
  assert.deepEqual(info.cis8_contract, { index: 12801, subindex: 0 });
  // supported_standards is informational; assert it only when present.
  if (info.supported_standards) {
    assert.ok(info.supported_standards.includes("CIS-8004"));
  }
});

test("live: the registry has real agents", async (t) => {
  const list = await liveOrSkip(t, () => liveListAgents(0, 5));
  if (!list) return;
  assert.ok(list.total > 1000, `expected 1000+ agents, got ${list.total}`);
  assert.equal(list.agents.length, 5);
  assert.equal(list.agents[0].token_id, 0);
});

test("live: fixture agent 1211 resolves on-chain and is Active", async (t) => {
  const agent = await liveOrSkip(t, () => liveAgentOf(LIVE_FIXTURE_TOKEN_ID));
  if (!agent) return;
  assert.equal(agent.status, "Active");
  assert.equal(
    agent.owner_account,
    "4j6RhVCWEG3GDQcwcgSQRxu7nmXSC4V834YrsVtudomCG6ueMH"
  );
  assert.match(agent.agent_uri, /^https:\/\//);
  assert.match(agent.metadata_hash_hex, /^[0-9a-f]{64}$/);
});

test("live: fixture badge verifies as VALID via REST", async (t) => {
  const check = await liveOrSkip(t, () => restCheckBadge(LIVE_FIXTURE_BADGE));
  if (!check) return;
  const agent = check.agents?.[0] ?? check;
  assert.equal(agent.badge_valid, true);
  assert.equal(agent.checks.on_chain_agent_found, true);
  assert.equal(agent.checks.status_active, true);
  assert.equal(agent.checks.card_fetched, true);
  assert.equal(agent.checks.hash_matches_on_chain, true);
  assert.equal(agent.checks.badge_present, true);
});

test("live: fixture card hash matches on-chain (REST verify + independent fetch)", async (t) => {
  const verify = await liveOrSkip(t, () => restVerifyAgentCard(LIVE_FIXTURE_BADGE));
  if (!verify) return;
  assert.equal(verify.fetched.http_status, 200);
  assert.equal(verify.fetched.sha256_hex, verify.on_chain_hash_hex);
  // Independent re-check: fetch the card ourselves and hash it.
  const res = await fetch(verify.on_chain_uri);
  assert.equal(res.status, 200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(sha256Hex(bytes), verify.on_chain_hash_hex);
});

test("live: get-badge-JSON returns the exact A2A extension for the fixture", async (t) => {
  const badgeJson = await liveOrSkip(t, () => restGetBadgeJson(LIVE_FIXTURE_BADGE));
  if (!badgeJson) return;
  assert.equal(badgeJson.token_id, LIVE_FIXTURE_TOKEN_ID);
  assert.equal(badgeJson.status, "Active");
  assert.equal(
    badgeJson.extension.uri,
    "https://docs.concordium.com/a2a-extensions/concordium-badge/v1"
  );
  assert.equal(
    badgeJson.extension.params.tokenAddress,
    `ccd:4221332d34e1694168c2a0c0b3fd0f27/cis-2:${LIVE_FIXTURE_BADGE}`
  );
  assert.deepEqual(badgeJson.registrations_entry, {
    agentId: LIVE_FIXTURE_TOKEN_ID,
    agentRegistry: "ccd:4221332d34e1694168c2a0c0b3fd0f27:12802.0",
  });
});

test("live: a dead card is honestly reported invalid (token 0)", async (t) => {
  // Token 0's agent_uri 404s (card removed). The verifier must say so —
  // this test proves our check distinguishes valid from invalid badges.
  const check = await liveOrSkip(t, () =>
    restCheckBadge("JyP9TtQC3HCNrTYR3sc2T")
  );
  if (!check) return;
  const agent = check.agents?.[0] ?? check;
  assert.equal(agent.badge_valid, false);
  assert.equal(agent.checks.on_chain_agent_found, true); // on-chain record exists
  assert.equal(agent.checks.card_fetched, false);
  assert.ok(agent.issues.length > 0);
});
