// tests/agent-card.test.js — Agent Card generation + hashing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAgentCard,
  cardToBytes,
  cardHash,
  sha256Hex,
  badgeExtension,
  AGENT_CARD_URL,
  TICKR_SKILLS,
} from "../src/agent-card.js";
import { BADGE_EXTENSION_URI, TESTNET_CAIP2 } from "../src/concordium.js";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("pre-registration card has tokenAddress null — never a fake badge", () => {
  const card = buildAgentCard({});
  assert.equal(card.name, "TICKR Verified");
  assert.equal(card.url, AGENT_CARD_URL);
  assert.equal(
    card.type,
    "https://eips.ethereum.org/EIPS/eip-8004#registration-v1"
  );
  assert.deepEqual(card.registrations, []);
  const ext = card.capabilities.extensions[0];
  assert.equal(ext.uri, BADGE_EXTENSION_URI);
  assert.equal(ext.params.tokenAddress, null);
  assert.equal(ext.params.owner.account, null);
  assert.equal(ext.params.verification.verifyUrl, undefined);
  // But the real testnet contract refs ARE present (they are public facts).
  assert.equal(
    ext.params.contracts.cis8004,
    `${TESTNET_CAIP2}:12802.0`
  );
  assert.equal(ext.params.contracts.cis8, `${TESTNET_CAIP2}:12801.0`);
});

test("badged card carries the CAIP-19 tokenAddress + registrations entry", () => {
  const card = buildAgentCard({
    ownerAccount: "3mC9tNFNDhTLJNjHHEdrjkqvcCDLDbff1ceA1b9xah9cfxeCKA",
    tokenId: 1211,
    badge: "JyP9XR6EkrzHnx9g177u9",
  });
  const ext = card.capabilities.extensions[0];
  assert.equal(
    ext.params.tokenAddress,
    `${TESTNET_CAIP2}/cis-2:JyP9XR6EkrzHnx9g177u9`
  );
  assert.equal(
    ext.params.owner.account,
    `${TESTNET_CAIP2}:3mC9tNFNDhTLJNjHHEdrjkqvcCDLDbff1ceA1b9xah9cfxeCKA`
  );
  assert.equal(
    ext.params.verification.verifyUrl,
    "https://agent-registry-mcp.concordium.com/v1/badge-check/JyP9XR6EkrzHnx9g177u9"
  );
  assert.deepEqual(card.registrations, [
    { agentId: 1211, agentRegistry: `${TESTNET_CAIP2}:12802.0` },
  ]);
});

test("card has the TICKR skills and x402Support false (honest)", () => {
  const card = buildAgentCard({});
  assert.equal(card.skills.length, TICKR_SKILLS.length);
  assert.ok(card.skills.some((s) => s.id === "analyze-tokenized-stocks"));
  assert.ok(card.skills.some((s) => s.id === "paper-trade-with-reason-hash"));
  assert.ok(card.skills.some((s) => s.id === "verify-concordium-badge"));
  assert.equal(card.x402Support, false); // x402 is a stretch goal, not claimed
  assert.equal(card.active, true);
});

test("card hash is deterministic and changes when the card changes", () => {
  const a = buildAgentCard({});
  const b = buildAgentCard({});
  assert.equal(cardHash(a), cardHash(b));
  assert.match(cardHash(a), /^[0-9a-f]{64}$/);
  const badged = buildAgentCard({
    ownerAccount: "3mC9tNFNDhTLJNjHHEdrjkqvcCDLDbff1ceA1b9xah9cfxeCKA",
    tokenId: 1211,
    badge: "JyP9XR6EkrzHnx9g177u9",
  });
  assert.notEqual(cardHash(badged), cardHash(a));
});

test("cardToBytes is the exact bytes that get hashed", () => {
  const card = buildAgentCard({});
  assert.equal(cardHash(card), sha256Hex(cardToBytes(card)));
  assert.ok(cardToBytes(card).endsWith("\n"));
});

test("sha256Hex matches Node's crypto", async () => {
  const { createHash } = await import("node:crypto");
  const expected = createHash("sha256").update("tickr").digest("hex");
  assert.equal(sha256Hex("tickr"), expected);
});

test("the repo's agent-card.json is the pre-registration card, byte-identical to the generator", () => {
  const onDisk = readFileSync(join(PROJECT_ROOT, "agent-card.json"), "utf8");
  const generated = cardToBytes(buildAgentCard({}));
  assert.equal(onDisk, generated);
  const parsed = JSON.parse(onDisk);
  assert.equal(parsed.capabilities.extensions[0].params.tokenAddress, null);
});

test("badgeExtension standalone helper matches the card's extension", () => {
  const ext = badgeExtension({ badge: "JyP9XR6EkrzHnx9g177u9", tokenId: 1211, ownerAccount: "3abc" });
  assert.equal(ext.uri, BADGE_EXTENSION_URI);
  assert.equal(ext.required, false);
  assert.equal(ext.params.tokenAddress, `${TESTNET_CAIP2}/cis-2:JyP9XR6EkrzHnx9g177u9`);
});
