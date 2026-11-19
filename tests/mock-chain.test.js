// tests/mock-chain.test.js — the mock Concordium chain: registration,
// metadata, CIS-8 binding, transfers, ownership rules, persistence.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MockConcordiumChain,
  MOCK_OWNER_ACCOUNT,
  MOCK_COUNTERPARTY_ACCOUNT,
  MOCK_START_TOKEN_ID,
  tokenIdToBadge,
} from "../src/concordium.js";
import { buildAgentCard, cardHash } from "../src/agent-card.js";

async function registeredChain() {
  const chain = new MockConcordiumChain();
  const card = buildAgentCard({});
  const reg = await chain.register({
    sender: MOCK_OWNER_ACCOUNT,
    agentUri: "https://example.invalid/agent-card.json",
    metadataHashHex: cardHash(card),
  });
  return { chain, reg };
}

test("register mints sequential token ids starting at 900000 with real-format badges", async () => {
  const chain = new MockConcordiumChain();
  const card = buildAgentCard({});
  const first = await chain.register({
    sender: MOCK_OWNER_ACCOUNT,
    agentUri: "https://example.invalid/a.json",
    metadataHashHex: cardHash(card),
  });
  assert.equal(first.tokenId, MOCK_START_TOKEN_ID);
  assert.equal(first.badge, await tokenIdToBadge(MOCK_START_TOKEN_ID));
  assert.ok(first.txHash.startsWith("mock-"));
  const second = await chain.register({ sender: MOCK_OWNER_ACCOUNT });
  assert.equal(second.tokenId, MOCK_START_TOKEN_ID + 1);
  assert.notEqual(second.badge, first.badge);
});

test("agentOf returns the public record; unknown token returns null", async () => {
  const { chain, reg } = await registeredChain();
  const agent = await chain.agentOf(reg.tokenId);
  assert.equal(agent.owner_account, MOCK_OWNER_ACCOUNT);
  assert.equal(agent.status, "Active");
  assert.equal(agent.agent_uri, "https://example.invalid/agent-card.json");
  assert.equal(agent.agent_wallet, MOCK_OWNER_ACCOUNT);
  assert.equal(await chain.agentOf(12345), null);
});

test("setAgentUri updates URI + hash; non-owner is rejected", async () => {
  const { chain, reg } = await registeredChain();
  await chain.setAgentUri(reg.tokenId, {
    sender: MOCK_OWNER_ACCOUNT,
    metadataHashHex: "ab".repeat(32),
  });
  const agent = await chain.agentOf(reg.tokenId);
  assert.equal(agent.metadata_hash_hex, "ab".repeat(32));
  assert.equal(agent.agent_uri, "https://example.invalid/agent-card.json"); // unchanged
  await assert.rejects(
    chain.setAgentUri(reg.tokenId, {
      sender: MOCK_COUNTERPARTY_ACCOUNT,
      metadataHashHex: "cd".repeat(32),
    }),
    /not the owner/
  );
});

test("setMetadata / getMetadata round-trips; reserved key rejected", async () => {
  const { chain, reg } = await registeredChain();
  const valueHex = Buffer.from('{"d":"BUY"}', "utf8").toString("hex");
  await chain.setMetadata(reg.tokenId, {
    sender: MOCK_OWNER_ACCOUNT,
    key: "tickr.log.000001",
    valueHex,
  });
  const entry = await chain.getMetadata(reg.tokenId, "tickr.log.000001");
  assert.equal(entry.value_hex, valueHex);
  assert.equal(entry.value_text, '{"d":"BUY"}');
  assert.equal(await chain.getMetadata(reg.tokenId, "tickr.log.999999"), null);
  await assert.rejects(
    chain.setMetadata(reg.tokenId, {
      sender: MOCK_OWNER_ACCOUNT,
      key: "agentWallet",
      valueHex: "00",
    }),
    /reserved key/
  );
  await assert.rejects(
    chain.setMetadata(reg.tokenId, {
      sender: MOCK_OWNER_ACCOUNT,
      key: "k".repeat(65),
      valueHex: "00",
    }),
    /longer than 64/
  );
});

test("CIS-8 binding records and looks up; duplicates rejected", async () => {
  const { chain } = await registeredChain();
  const externalKey = {
    namespace: "eip155:84532",
    key_type: "secp256k1-uncompressed",
    public_key_hex: "822bbe7174fc3e54cc278ad35dde6532b2f8415b",
  };
  const { txHash } = await chain.cis8Register({
    sender: MOCK_OWNER_ACCOUNT,
    externalKey,
    proof: { scheme: "ethereum-personal-sign", signature_hex: "ab".repeat(65) },
  });
  assert.ok(txHash.startsWith("mock-"));
  const binding = chain.cis8Lookup(externalKey);
  assert.equal(binding.concordium_account, MOCK_OWNER_ACCOUNT);
  assert.equal(binding.proof_scheme, "ethereum-personal-sign");
  await assert.rejects(
    chain.cis8Register({
      sender: MOCK_OWNER_ACCOUNT,
      externalKey,
      proof: { scheme: "ethereum-personal-sign", signature_hex: "cd".repeat(65) },
    }),
    /already bound/
  );
});

test("setExternalReference attaches the CIS-8 binding to the agent", async () => {
  const { chain, reg } = await registeredChain();
  const ref = {
    contract_address: { index: 12801, subindex: 0 },
    kind: "Cis8",
    key: {
      namespace: "eip155:84532",
      key_type: "secp256k1-uncompressed",
      public_key_hex: "822bbe7174fc3e54cc278ad35dde6532b2f8415b",
    },
  };
  await chain.setExternalReference(reg.tokenId, {
    sender: MOCK_OWNER_ACCOUNT,
    externalReference: ref,
  });
  const agent = await chain.agentOf(reg.tokenId);
  assert.deepEqual(agent.external_reference, ref);
});

test("transfer moves CCD, records the memo, and enforces balances", async () => {
  const chain = new MockConcordiumChain();
  const before = chain.getBalance(MOCK_OWNER_ACCOUNT);
  const record = await chain.transfer({
    sender: MOCK_OWNER_ACCOUNT,
    to: MOCK_COUNTERPARTY_ACCOUNT,
    amountMicroCcd: 1_500_000n,
    memo: "tickr:pay-for-signal;seq:000001",
  });
  assert.ok(record.txHash.startsWith("mock-"));
  assert.equal(record.memo, "tickr:pay-for-signal;seq:000001");
  assert.equal(chain.getBalance(MOCK_OWNER_ACCOUNT), before - 1_500_000n);
  await assert.rejects(
    chain.transfer({
      sender: MOCK_OWNER_ACCOUNT,
      to: MOCK_COUNTERPARTY_ACCOUNT,
      amountMicroCcd: before, // more than the remaining balance
    }),
    /insufficient balance/
  );
  await assert.rejects(
    chain.transfer({
      sender: MOCK_OWNER_ACCOUNT,
      to: MOCK_COUNTERPARTY_ACCOUNT,
      amountMicroCcd: 0n,
    }),
    /must be positive/
  );
});

test("revoke flips status and blocks further writes", async () => {
  const { chain, reg } = await registeredChain();
  await chain.revoke(reg.tokenId, { sender: MOCK_OWNER_ACCOUNT });
  const agent = await chain.agentOf(reg.tokenId);
  assert.equal(agent.status, "Revoked");
  await assert.rejects(
    chain.setMetadata(reg.tokenId, {
      sender: MOCK_OWNER_ACCOUNT,
      key: "tickr.log.000001",
      valueHex: "00",
    }),
    /not Active/
  );
});

test("agentsByOwner and listAgents enumerate the registry", async () => {
  const { chain } = await registeredChain();
  await chain.register({ sender: MOCK_COUNTERPARTY_ACCOUNT });
  const mine = await chain.agentsByOwner(MOCK_OWNER_ACCOUNT);
  assert.equal(mine.length, 1);
  const listed = await chain.listAgents(0, 10);
  assert.equal(listed.total, 2);
  assert.equal(listed.count, 2);
  const page = await chain.listAgents(1, 1);
  assert.equal(page.count, 1);
  assert.equal(page.agents[0].owner_account, MOCK_COUNTERPARTY_ACCOUNT);
});

test("state persists to disk and reloads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tickr-mock-"));
  try {
    const statePath = join(dir, "state.json");
    const chain = new MockConcordiumChain(statePath);
    const card = buildAgentCard({});
    const reg = await chain.register({
      sender: MOCK_OWNER_ACCOUNT,
      agentUri: "https://example.invalid/a.json",
      metadataHashHex: cardHash(card),
    });
    await chain.setMetadata(reg.tokenId, {
      sender: MOCK_OWNER_ACCOUNT,
      key: "tickr.log.000001",
      valueHex: Buffer.from("{}", "utf8").toString("hex"),
    });
    const reloaded = new MockConcordiumChain(statePath);
    const agent = await reloaded.agentOf(reg.tokenId);
    assert.equal(agent.owner_account, MOCK_OWNER_ACCOUNT);
    const entry = await reloaded.getMetadata(reg.tokenId, "tickr.log.000001");
    assert.equal(entry.value_text, "{}");
    // Next token id continues, not restarts.
    const next = await reloaded.register({ sender: MOCK_OWNER_ACCOUNT });
    assert.equal(next.tokenId, reg.tokenId + 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("networkStatus reports mock mode honestly", async () => {
  const chain = new MockConcordiumChain();
  const status = await chain.networkStatus();
  assert.equal(status.network, "mock");
  assert.match(status.note, /MOCK MODE/);
});
