// tests/badge.test.js — CIS-2 token-address (badge) encoding.
//
// The expected values are REAL badges read from live testnet on 19 Nov 2026
// (via the MCP list_agents + REST check-badge endpoints), so these tests pin
// our encoding against the live registry, not against ourselves.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tokenIdToBadge,
  badgeToTokenId,
  tokenIdToTokenIdHex,
  tokenIdHexToNumber,
  badgeToCaip19,
  TESTNET_CAIP2,
} from "../src/concordium.js";

// token id -> live badge short form (testnet CIS-8004 <12802, 0>)
const KNOWN = [
  [0, "JyP9TtQC3HCNrTYR3sc2T"],
  [1204, "JyP9XHRsEgVnz5VDioFFj"],
  [1211, "JyP9XR6EkrzHnx9g177u9"],
];

for (const [tokenId, badge] of KNOWN) {
  test(`token ${tokenId} encodes to live badge ${badge}`, async () => {
    assert.equal(await tokenIdToBadge(tokenId), badge);
  });
  test(`live badge ${badge} parses back to token ${tokenId}`, async () => {
    assert.equal(await badgeToTokenId(badge), tokenId);
  });
}

test("token id hex is 8 bytes little-endian (TokenIdU64)", () => {
  assert.equal(tokenIdToTokenIdHex(0), "0000000000000000");
  assert.equal(tokenIdToTokenIdHex(1211), "bb04000000000000");
  assert.equal(tokenIdToTokenIdHex(900000), "a0bb0d0000000000");
  assert.equal(tokenIdHexToNumber("bb04000000000000"), 1211);
});

test("CAIP-19 form uses the testnet chain id", () => {
  assert.equal(
    badgeToCaip19("JyP9XR6EkrzHnx9g177u9"),
    `${TESTNET_CAIP2}/cis-2:JyP9XR6EkrzHnx9g177u9`
  );
  assert.equal(TESTNET_CAIP2, "ccd:4221332d34e1694168c2a0c0b3fd0f27");
});

test("mock token ids (900000+) encode to distinct badges", async () => {
  const a = await tokenIdToBadge(900000);
  const b = await tokenIdToBadge(900001);
  assert.notEqual(a, b);
  assert.equal(await badgeToTokenId(a), 900000);
});
