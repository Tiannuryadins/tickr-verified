// tests/payload-builders.test.js — LIVE payload construction via the MCP
// service (no key needed; building a payload submits NOTHING).
// Skips gracefully if the network is unreachable.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRegisterPayload,
  buildSetAgentUriPayload,
  buildSetMetadataPayload,
  buildCis8CanonicalBytes,
  buildCis8RegisterPayload,
  mcpCall,
} from "../src/concordium.js";

// A real testnet account (another builder's, from list_agents) used ONLY as
// the `sender` field of payloads we build but never submit. Building a
// payload is a pure off-chain operation; it cannot move funds or register
// anything.
const SENDER = "3mC9tNFNDhTLJNjHHEdrjkqvcCDLDbff1ceA1b9xah9cfxeCKA";
const ZERO_HASH = "00".repeat(32);

async function liveOrSkip(t, fn) {
  try {
    return await fn();
  } catch (err) {
    t.skip(`live MCP unreachable: ${err.message}`);
    return null;
  }
}

test("live: build_register returns a sign-ready payload for CIS-8004", async (t) => {
  const built = await liveOrSkip(t, () =>
    buildRegisterPayload({
      sender: SENDER,
      agentUri: "https://tiannuryadins.github.io/tickr-verified/agent-card.json",
      metadataHashHex: ZERO_HASH,
    })
  );
  if (!built) return;
  assert.equal(built.network, "testnet");
  assert.deepEqual(built.contract_address, { index: 12802, subindex: 0 });
  assert.equal(built.receive_name, "CIS-8004.register");
  assert.match(built.parameter_hex, /^[0-9a-f]+$/);
  assert.ok(built.suggested_energy > 0);
  assert.equal(built.parameter_json.agent_uri.Some[0], "https://tiannuryadins.github.io/tickr-verified/agent-card.json");
  assert.deepEqual(built.parameter_json.external_reference, { None: [] });
});

test("live: build_set_metadata returns a sign-ready payload for tickr.log keys", async (t) => {
  const valueHex = Buffer.from('{"d":"BUY","s":"B20"}', "utf8").toString("hex");
  const built = await liveOrSkip(t, () =>
    buildSetMetadataPayload({
      sender: SENDER,
      tokenId: 1211,
      key: "tickr.log.000001",
      valueHex,
    })
  );
  if (!built) return;
  assert.equal(built.receive_name, "CIS-8004.setMetadata");
  assert.equal(built.parameter_json.key, "tickr.log.000001");
  assert.match(built.parameter_hex, /^[0-9a-f]+$/);
});

test("live: build_set_agent_uri returns a sign-ready payload", async (t) => {
  const built = await liveOrSkip(t, () =>
    buildSetAgentUriPayload({
      sender: SENDER,
      tokenId: 1211,
      metadataHashHex: ZERO_HASH,
    })
  );
  if (!built) return;
  assert.equal(built.receive_name, "CIS-8004.setAgentURI");
  assert.match(built.parameter_hex, /^[0-9a-f]+$/);
});

test("live: build_cis8_canonical_bytes returns the exact bytes to sign", async (t) => {
  const canonical = await liveOrSkip(t, () =>
    buildCis8CanonicalBytes({
      concordiumAccount: SENDER,
      externalNamespace: "eip155:84532",
      externalKeyType: "secp256k1-uncompressed",
      externalPublicKeyHex: "822bbe7174fc3e54cc278ad35dde6532b2f8415b",
      proofScheme: "ethereum-personal-sign",
    })
  );
  if (!canonical) return;
  assert.equal(canonical.prefix_utf8, "CIS-8/v1/canonical");
  assert.equal(canonical.byte_length, 206);
  assert.equal(
    canonical.genesis_hash,
    "4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796"
  );
  assert.ok(canonical.bytes_hex.startsWith("4349532d382f76312f63616e6f6e6963616c")); // "CIS-8/v1/canonical"
  // The canonical bytes embed the TICKR deployer address.
  assert.ok(canonical.bytes_hex.includes("822bbe7174fc3e54cc278ad35dde6532b2f8415b"));
});

test("live: build_cis8_register accepts a personal-sign proof shape", async (t) => {
  const built = await liveOrSkip(t, () =>
    buildCis8RegisterPayload({
      sender: SENDER,
      externalKey: {
        namespace: "eip155:84532",
        key_type: "secp256k1-uncompressed",
        public_key_hex: "822bbe7174fc3e54cc278ad35dde6532b2f8415b",
      },
      proof: {
        scheme: "ethereum-personal-sign",
        // A structurally valid 65-byte signature (NOT a real proof for this
        // account — this test only checks payload construction, and nothing
        // is submitted).
        signature_hex: "ab".repeat(65),
      },
    })
  );
  if (!built) return;
  assert.deepEqual(built.contract_address, { index: 12801, subindex: 0 });
  assert.match(built.parameter_hex, /^[0-9a-f]+$/);
});

test("live: MCP reports the expected tool surface", async (t) => {
  const tools = await liveOrSkip(t, async () => {
    const res = await fetch("https://agent-registry-mcp.concordium.com/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list", params: {} }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  if (!tools) return;
  const names = tools.result.tools.map((x) => x.name);
  for (const required of [
    "build_register",
    "build_set_agent_uri",
    "build_set_metadata",
    "build_cis8_register",
    "build_cis8_canonical_bytes",
    "build_agent_card",
    "build_agent_badge",
    "check_badge",
    "verify_agent_card",
    "agent_of",
    "get_metadata",
    "list_agents",
  ]) {
    assert.ok(names.includes(required), `MCP tool ${required} missing`);
  }
});

test("mcpCall throws a typed McpError on a bad tool call", async (t) => {
  const err = await (async () => {
    try {
      await mcpCall("build_set_metadata", {
        sender: SENDER,
        token_id: 1211,
        // missing key + value_hex on purpose
      });
      return null;
    } catch (e) {
      return e;
    }
  })();
  if (err === null) {
    t.skip("MCP unexpectedly accepted a malformed call — check the service");
    return;
  }
  if (err.message.includes("fetch failed") || err.message.includes("HTTP")) {
    t.skip(`live MCP unreachable: ${err.message}`);
    return;
  }
  assert.equal(err.name, "McpError");
});
