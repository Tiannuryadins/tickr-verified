// concordium.js — the chain layer for TICKR Verified.
//
// Two modes behind ONE interface:
//   - "mock"    (default): a local in-memory Concordium that faithfully mirrors
//                 the real CIS-8004 / CIS-8 interfaces. Fully testable offline.
//                 Everything it produces is labelled MOCK and is never a real
//                 transaction.
//   - "testnet": the same code path, signing + submitting via
//                 @concordium/web-sdk against the public testnet node, with
//                 the account key loaded from a mode-600 file OUTSIDE the repo
//                 (env var CONCORDIUM_KEY_FILE). Fails cleanly with the
//                 unblock step when no key is present — never fakes a submit.
//
// Reads that need no key (network status, contract info, agent lookup, badge
// checks, payload building) go through the hosted Agent Registry MCP service
// (JSON-RPC + plain REST), which is live and needs no auth. Those are used in
// BOTH modes for verification.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// --- Network constants (verified live 19 Nov 2026; see RESEARCH.md) ---------
export const TESTNET_NODE_HOST = "https://grpc.testnet.concordium.com";
export const TESTNET_NODE_PORT = 20000;
export const TESTNET_EXPLORER = "https://testnet.ccdscan.io";
export const MCP_URL = "https://agent-registry-mcp.concordium.com/mcp";
export const MCP_REST = "https://agent-registry-mcp.concordium.com/v1";
export const FAUCET_URL =
  "https://wallet-proxy.testnet.concordium.com/v0/testnetGTUDrop";

export const CIS8004_CONTRACT = { index: 12802, subindex: 0 }; // testnet
export const CIS8_CONTRACT = { index: 12801, subindex: 0 }; // testnet

// Testnet genesis hash (full, from the live MCP build_cis8_canonical_bytes
// response, 19 Nov 2026). CAIP-2 chain id = first 32 hex chars.
export const TESTNET_GENESIS_HASH =
  "4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796";
export const TESTNET_CAIP2 = `ccd:${TESTNET_GENESIS_HASH.slice(0, 32)}`;
export const BADGE_EXTENSION_URI =
  "https://docs.concordium.com/a2a-extensions/concordium-badge/v1";

export const MICRO_CCD_PER_CCD = 1_000_000n;

// A real, fully-valid testnet badge (token 1211, owner
// 4j6RhVCWEG3GDQcwcgSQRxu7nmXSC4V834YrsVtudomCG6ueMH) used as the live
// verification fixture: check-badge returned badge_valid=true, HTTP 200,
// hash match, badge present on 19 Nov 2026. It belongs to another builder's
// demo agent — we use it only as a read-only verification target.
export const LIVE_FIXTURE_BADGE = "JyP9XR6EkrzHnx9g177u9";
export const LIVE_FIXTURE_TOKEN_ID = 1211;

// --- Errors ------------------------------------------------------------------
export class TestnetKeyMissingError extends Error {
  constructor() {
    super(
      "testnet key not configured — see STATUS.md § Unblock step.\n" +
        "No Concordium testnet account key was found. Set CONCORDIUM_KEY_FILE to a " +
        "mode-600 Browser Wallet export (.export file) outside this repo, e.g. " +
        "~/.config/concordium-trusted-agents/testnet-account.export.\n" +
        "To create one: install the Concordium Browser Wallet → create a testnet " +
        "identity (\"Concordium testnet IP\", no ID needed on testnet) → fund it " +
        "from the faucet → export the account key. No testnet transaction was " +
        "submitted."
    );
    this.name = "TestnetKeyMissingError";
    this.code = "TESTNET_KEY_MISSING";
  }
}

export class McpError extends Error {
  constructor(tool, message) {
    super(`MCP tool ${tool} failed: ${message}`);
    this.name = "McpError";
    this.tool = tool;
  }
}

// --- MCP client (JSON-RPC 2.0, streamable HTTP; no auth) ---------------------
let mcpRequestId = 0;

/**
 * Call one Agent Registry MCP tool. Returns the parsed JSON payload from the
 * tool's text content (tools return JSON strings). Throws McpError on a
 * tool-level error or a transport failure.
 */
export async function mcpCall(tool, args = {}, fetchFn = fetch) {
  const id = ++mcpRequestId;
  const res = await fetchFn(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: tool, arguments: { network: "testnet", ...args } },
    }),
  });
  if (!res.ok) {
    throw new McpError(tool, `HTTP ${res.status} from MCP service`);
  }
  const data = await res.json();
  if (data.error) {
    throw new McpError(tool, data.error.message || JSON.stringify(data.error));
  }
  const content = data.result?.content?.[0];
  if (!content || content.type !== "text") {
    throw new McpError(tool, "unexpected MCP response shape");
  }
  if (data.result.isError) {
    throw new McpError(tool, content.text);
  }
  try {
    return JSON.parse(content.text);
  } catch {
    return content.text;
  }
}

// --- MCP REST twins (plain GET, no auth) -------------------------------------
async function restGet(path, fetchFn = fetch) {
  const res = await fetchFn(`${MCP_REST}${path}`);
  if (!res.ok) throw new Error(`REST ${path} -> HTTP ${res.status}`);
  return res.json();
}

/** Full badge verdict: on-chain record, card fetch + SHA-256 match, badge well-formedness. */
export function restCheckBadge(badgeOrAccount, fetchFn = fetch) {
  return restGet(
    `/check-badge/${encodeURIComponent(badgeOrAccount)}?network=testnet`,
    fetchFn
  );
}

/** Verify an agent's card bytes against its on-chain metadata_hash. */
export function restVerifyAgentCard(badge, fetchFn = fetch) {
  return restGet(
    `/verify-agent-card/${encodeURIComponent(badge)}?network=testnet`,
    fetchFn
  );
}

/** The exact A2A extension object to paste into an Agent Card for a badge. */
export function restGetBadgeJson(badge, fetchFn = fetch) {
  return restGet(
    `/get-badge-JSON/${encodeURIComponent(badge)}?network=testnet`,
    fetchFn
  );
}

// --- Live reads (no key needed) ----------------------------------------------
export const liveNetworkStatus = (fetchFn) =>
  mcpCall("network_status", {}, fetchFn);
export const liveContractInfo = (fetchFn) =>
  mcpCall("contract_info", {}, fetchFn);
export const liveAgentOf = (tokenId, fetchFn) =>
  mcpCall("agent_of", { token_id: tokenId }, fetchFn);
export const liveAgentsByOwner = (ownerAccount, fetchFn) =>
  mcpCall("agents_by_owner", { owner_account: ownerAccount }, fetchFn);
export const liveListAgents = (offset = 0, limit = 20, fetchFn) =>
  mcpCall("list_agents", { offset, limit }, fetchFn);
export const liveGetMetadata = (tokenId, key, fetchFn) =>
  mcpCall("get_metadata", { token_id: tokenId, key }, fetchFn);
export const liveAgentByTokenAddress = (tokenAddress, fetchFn) =>
  mcpCall("agent_by_token_address", { token_address: tokenAddress }, fetchFn);

// --- Payload builders (sign-ready {parameter_hex, ...}; no key needed) -------
export function buildRegisterPayload({ sender, agentUri, metadataHashHex }) {
  return mcpCall("build_register", {
    sender,
    agent_uri: agentUri ?? null,
    metadata_hash_hex: metadataHashHex ?? null,
  });
}

export function buildSetAgentUriPayload({ sender, tokenId, agentUri, metadataHashHex }) {
  return mcpCall("build_set_agent_uri", {
    sender,
    token_id: tokenId,
    agent_uri: agentUri ?? null,
    metadata_hash_hex: metadataHashHex ?? null,
  });
}

export function buildSetMetadataPayload({ sender, tokenId, key, valueHex }) {
  return mcpCall("build_set_metadata", {
    sender,
    token_id: tokenId,
    key,
    value_hex: valueHex,
  });
}

export function buildCis8CanonicalBytes({
  concordiumAccount,
  externalNamespace,
  externalKeyType,
  externalPublicKeyHex,
  proofScheme = "ethereum-personal-sign",
}) {
  return mcpCall("build_cis8_canonical_bytes", {
    concordium_account: concordiumAccount,
    external_namespace: externalNamespace,
    external_key_namespace: externalNamespace,
    external_key_type: externalKeyType,
    external_public_key_hex: externalPublicKeyHex,
    proof_scheme: proofScheme,
  });
}

export function buildCis8RegisterPayload({ sender, externalKey, proof, metadata }) {
  return mcpCall("build_cis8_register", {
    sender,
    external_key: externalKey,
    proof,
    metadata: metadata ?? null,
  });
}

export function buildSetExternalReferencePayload({ sender, tokenId, externalReference }) {
  return mcpCall("build_set_external_reference", {
    sender,
    token_id: tokenId,
    external_reference: externalReference,
  });
}

// --- Badge encoding (via the SDK's CIS-2 helpers) ----------------------------
// The short form is Base58Check(0x02 || ULEB128(index) || ULEB128(subindex)
// || token_id as 8 bytes LE). Verified against three live badges:
//   token 0    -> JyP9TtQC3HCNrTYR3sc2T
//   token 1204 -> JyP9XHRsEgVnz5VDioFFj
//   token 1211 -> JyP9XR6EkrzHnx9g177u9
export async function tokenIdToBadge(tokenId) {
  const { tokenAddressToBase58 } = await import("@concordium/web-sdk");
  return tokenAddressToBase58({
    contract: {
      index: BigInt(CIS8004_CONTRACT.index),
      subindex: BigInt(CIS8004_CONTRACT.subindex),
    },
    id: tokenIdToTokenIdHex(tokenId),
  });
}

export async function badgeToTokenId(badge) {
  const { tokenAddressFromBase58 } = await import("@concordium/web-sdk");
  const parsed = tokenAddressFromBase58(badge);
  return tokenIdHexToNumber(parsed.id);
}

/** TokenIdU64: 8 bytes little-endian, as a 16-char hex string. */
export function tokenIdToTokenIdHex(tokenId) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(tokenId));
  return buf.toString("hex");
}

export function tokenIdHexToNumber(hex) {
  return Number(Buffer.from(hex, "hex").readBigUInt64LE(0));
}

/** CAIP-19 canonical badge form: ccd:<chain>/cis-2:<short badge>. */
export function badgeToCaip19(badge) {
  return `${TESTNET_CAIP2}/cis-2:${badge}`;
}

// --- Testnet account key loading ---------------------------------------------
/**
 * Load the Concordium testnet account from the Browser Wallet export file
 * named by CONCORDIUM_KEY_FILE. The file is a JSON wallet export:
 * { type, v, environment, value: { address, credentials, accountKeys } }
 * where accountKeys["0"].keys["0"].signKey is the ed25519 signing key.
 *
 * The key is NEVER printed or logged; only the public address is returned
 * alongside the signer material. Throws TestnetKeyMissingError when the env
 * var is unset or the file is missing/unreadable.
 */
export function loadTestnetAccount() {
  const keyFile = process.env.CONCORDIUM_KEY_FILE;
  if (!keyFile) throw new TestnetKeyMissingError();
  let raw;
  try {
    raw = readFileSync(keyFile, "utf8");
  } catch {
    throw new TestnetKeyMissingError();
  }
  let wallet;
  try {
    wallet = JSON.parse(raw);
  } catch {
    throw new Error(
      `CONCORDIUM_KEY_FILE ${keyFile} is not valid JSON. Expected a Browser Wallet .export file.`
    );
  }
  // Browser Wallet export: { type, v, environment, value: {...} }.
  const value = wallet.value ?? wallet;
  const address = value.address;
  const accountKeys = value.accountKeys;
  if (!address || !accountKeys) {
    throw new Error(
      `CONCORDIUM_KEY_FILE ${keyFile} is not a recognised wallet export: ` +
        `expected value.address + value.accountKeys.`
    );
  }
  const firstCred = accountKeys["0"] ?? Object.values(accountKeys)[0];
  const keys = firstCred?.keys;
  const firstKey = keys?.["0"] ?? (keys ? Object.values(keys)[0] : undefined);
  const signKey = firstKey?.signKey;
  if (!signKey || typeof signKey !== "string" || signKey.length !== 64) {
    throw new Error(
      `CONCORDIUM_KEY_FILE ${keyFile}: could not find a 64-hex-char signKey ` +
        `under accountKeys[0].keys[0].signKey.`
    );
  }
  return { address, signKey, keyFile };
}

// --- Mock chain --------------------------------------------------------------
// A faithful in-memory mirror of the CIS-8004 / CIS-8 interfaces. Token ids
// start at 900000 (far above the live testnet count of ~1,285 on 19 Nov 2026)
// so mock badges can never collide with real ones. Mock tx hashes are
// prefixed "mock-" and mock accounts are clearly labelled.
export const MOCK_OWNER_ACCOUNT = "MOCK-OWNER-3tickr-verified-00000000000001";
export const MOCK_COUNTERPARTY_ACCOUNT =
  "MOCK-COUNTERPARTY-3tickr-verified-0000000002";
export const MOCK_START_TOKEN_ID = 900000;
export const MOCK_STARTING_BALANCE_MICRO_CCD = 1_000_000_000_000n; // 1,000,000 CCD

function mockTxHash(seed) {
  return (
    "mock-" +
    createHash("sha256").update(seed).digest("hex").slice(0, 32)
  );
}

export class MockConcordiumChain {
  constructor(statePath = null) {
    this.mode = "mock";
    this.statePath = statePath;
    this.reset();
    if (statePath && existsSync(statePath)) this.load(statePath);
  }

  reset() {
    this.nextTokenId = MOCK_START_TOKEN_ID;
    this.blockHeight = 51_016_077; // testnet height at build time (19 Nov 2026)
    this.accounts = new Map([
      [MOCK_OWNER_ACCOUNT, { balance: MOCK_STARTING_BALANCE_MICRO_CCD, nonce: 1 }],
      [MOCK_COUNTERPARTY_ACCOUNT, { balance: MOCK_STARTING_BALANCE_MICRO_CCD, nonce: 1 }],
    ]);
    this.agents = new Map(); // tokenId -> agent record
    this.cis8 = new Map(); // external key (namespace:key_type:pubkey) -> binding
    this.transfers = [];
  }

  save(path = this.statePath) {
    if (!path) return;
    const state = {
      nextTokenId: this.nextTokenId,
      blockHeight: this.blockHeight,
      accounts: [...this.accounts.entries()].map(([a, v]) => [
        a,
        { balance: v.balance.toString(), nonce: v.nonce },
      ]),
      agents: [...this.agents.entries()].map(([id, a]) => [
        id,
        { ...a, metadata: [...a.metadata.entries()] },
      ]),
      cis8: [...this.cis8.entries()],
      transfers: this.transfers.map((t) => ({
        ...t,
        amountMicroCcd: t.amountMicroCcd.toString(),
      })),
    };
    writeFileSync(path, JSON.stringify(state, null, 2));
  }

  load(path) {
    const state = JSON.parse(readFileSync(path, "utf8"));
    this.nextTokenId = state.nextTokenId;
    this.blockHeight = state.blockHeight;
    this.accounts = new Map(
      state.accounts.map(([a, v]) => [
        a,
        { balance: BigInt(v.balance), nonce: v.nonce },
      ])
    );
    this.agents = new Map(
      state.agents.map(([id, a]) => [
        Number(id),
        { ...a, metadata: new Map(a.metadata) },
      ])
    );
    this.cis8 = new Map(state.cis8);
    this.transfers = state.transfers.map((t) => ({
      ...t,
      amountMicroCcd: BigInt(t.amountMicroCcd),
    }));
  }

  getOwnerAccount() {
    return MOCK_OWNER_ACCOUNT;
  }

  getBalance(account) {
    return this.accounts.get(account)?.balance ?? 0n;
  }

  async networkStatus() {
    return {
      network: "mock",
      node_url: "mock://in-memory",
      latest_block_height: this.blockHeight,
      note: "MOCK MODE — no real chain. Block height seeded from live testnet at build time.",
    };
  }

  async register({ sender, agentUri = null, metadataHashHex = null, externalReference = null, initialMetadata = [] }) {
    if (!this.accounts.has(sender)) {
      throw new Error(`Mock chain: unknown sender account ${sender}`);
    }
    const tokenId = this.nextTokenId++;
    const metadata = new Map();
    for (const { key, value_hex } of initialMetadata) {
      metadata.set(key, value_hex);
    }
    const now = new Date().toISOString();
    const agent = {
      token_id: tokenId,
      owner_account: sender,
      agent_uri: agentUri,
      metadata_hash_hex: metadataHashHex,
      agent_wallet: sender,
      external_reference: externalReference,
      status: "Active",
      registered_at: now,
      last_event_block: ++this.blockHeight,
      metadata,
    };
    this.agents.set(tokenId, agent);
    const badge = await tokenIdToBadge(tokenId);
    const txHash = mockTxHash(`register:${tokenId}:${sender}:${now}`);
    this.save();
    return { tokenId, badge, txHash, agent: this.publicAgent(agent) };
  }

  async setAgentUri(tokenId, { sender, agentUri = null, metadataHashHex = null }) {
    const agent = this.requireOwner(tokenId, sender);
    if (agentUri !== null) agent.agent_uri = agentUri;
    if (metadataHashHex !== null) agent.metadata_hash_hex = metadataHashHex;
    agent.last_event_block = ++this.blockHeight;
    const txHash = mockTxHash(`setAgentURI:${tokenId}:${agentUri}:${metadataHashHex}`);
    this.save();
    return { txHash, agent: this.publicAgent(agent) };
  }

  async setMetadata(tokenId, { sender, key, valueHex }) {
    const agent = this.requireOwner(tokenId, sender);
    if (key.length > 64) throw new Error("Mock chain: metadata key longer than 64 chars.");
    if (key === "agentWallet") {
      throw new Error("Mock chain: reserved key agentWallet is rejected (use setAgentWallet).");
    }
    agent.metadata.set(key, valueHex);
    agent.last_event_block = ++this.blockHeight;
    const txHash = mockTxHash(`setMetadata:${tokenId}:${key}:${valueHex}`);
    this.save();
    return { txHash };
  }

  async getMetadata(tokenId, key) {
    const agent = this.agents.get(Number(tokenId));
    if (!agent) return null;
    const valueHex = agent.metadata.get(key);
    if (valueHex === undefined) return null;
    let valueText = null;
    try {
      valueText = Buffer.from(valueHex, "hex").toString("utf8");
    } catch {
      valueText = null;
    }
    return { key, value_hex: valueHex, value_text: valueText };
  }

  async setExternalReference(tokenId, { sender, externalReference }) {
    const agent = this.requireOwner(tokenId, sender);
    agent.external_reference = externalReference;
    agent.last_event_block = ++this.blockHeight;
    const txHash = mockTxHash(`setExternalReference:${tokenId}:${JSON.stringify(externalReference)}`);
    this.save();
    return { txHash, agent: this.publicAgent(agent) };
  }

  async cis8Register({ sender, externalKey, proof, metadata = [] }) {
    const bindingKey = `${externalKey.namespace}:${externalKey.key_type}:${externalKey.public_key_hex}`;
    if (this.cis8.has(bindingKey)) {
      throw new Error("Mock chain: external key already bound to a Concordium account.");
    }
    this.cis8.set(bindingKey, {
      concordium_account: sender,
      external_key: externalKey,
      proof_scheme: proof.scheme,
      metadata,
      bound_at: new Date().toISOString(),
      block: ++this.blockHeight,
    });
    const txHash = mockTxHash(`cis8:${bindingKey}:${sender}`);
    this.save();
    return { txHash };
  }

  cis8Lookup(externalKey) {
    const bindingKey = `${externalKey.namespace}:${externalKey.key_type}:${externalKey.public_key_hex}`;
    return this.cis8.get(bindingKey) ?? null;
  }

  async revoke(tokenId, { sender }) {
    const agent = this.requireOwner(tokenId, sender);
    agent.status = "Revoked";
    agent.last_event_block = ++this.blockHeight;
    const txHash = mockTxHash(`revoke:${tokenId}`);
    this.save();
    return { txHash };
  }

  async transfer({ sender, to, amountMicroCcd, memo = null }) {
    const from = this.accounts.get(sender);
    if (!from) throw new Error(`Mock chain: unknown sender account ${sender}`);
    const amount = BigInt(amountMicroCcd);
    if (amount <= 0n) throw new Error("Mock chain: transfer amount must be positive.");
    if (from.balance < amount) throw new Error("Mock chain: insufficient balance.");
    if (!this.accounts.has(to)) {
      this.accounts.set(to, { balance: 0n, nonce: 1 });
    }
    from.balance -= amount;
    this.accounts.get(to).balance += amount;
    const txHash = mockTxHash(`transfer:${sender}:${to}:${amount}:${this.transfers.length}`);
    const record = {
      txHash,
      from: sender,
      to,
      amountMicroCcd: amount,
      memo,
      block: ++this.blockHeight,
      at: new Date().toISOString(),
    };
    this.transfers.push(record);
    this.save();
    return record;
  }

  async agentOf(tokenId) {
    const agent = this.agents.get(Number(tokenId));
    return agent ? this.publicAgent(agent) : null;
  }

  async agentsByOwner(ownerAccount) {
    return [...this.agents.values()]
      .filter((a) => a.owner_account === ownerAccount)
      .map((a) => this.publicAgent(a));
  }

  async listAgents(offset = 0, limit = 20) {
    const all = [...this.agents.values()].map((a) => this.publicAgent(a));
    return { network: "mock", count: all.slice(offset, offset + limit).length, total: all.length, agents: all.slice(offset, offset + limit) };
  }

  requireOwner(tokenId, sender) {
    const agent = this.agents.get(Number(tokenId));
    if (!agent) throw new Error(`Mock chain: no agent with token id ${tokenId}.`);
    if (agent.owner_account !== sender) {
      throw new Error(`Mock chain: ${sender} is not the owner of agent ${tokenId}.`);
    }
    if (agent.status !== "Active") {
      throw new Error(`Mock chain: agent ${tokenId} is ${agent.status}, not Active.`);
    }
    return agent;
  }

  publicAgent(agent) {
    const { metadata, ...rest } = agent;
    return { ...rest, metadata_keys: [...metadata.keys()] };
  }
}

// --- Testnet chain (SDK-based; needs a key) ----------------------------------
export class TestnetConcordiumChain {
  constructor() {
    this.mode = "testnet";
    // Fail fast and cleanly: no key, no chain object at all.
    this.account = loadTestnetAccount();
    this.clientPromise = null;
  }

  getOwnerAccount() {
    return this.account.address;
  }

  async client() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { ConcordiumGRPCWebClient } = await import("@concordium/web-sdk");
        return new ConcordiumGRPCWebClient(TESTNET_NODE_HOST, TESTNET_NODE_PORT);
      })();
    }
    return this.clientPromise;
  }

  async signer() {
    const { buildBasicAccountSigner } = await import("@concordium/web-sdk");
    return buildBasicAccountSigner(this.account.signKey);
  }

  async networkStatus() {
    return liveNetworkStatus();
  }

  async getBalance(account) {
    const client = await this.client();
    const { AccountAddress } = await import("@concordium/web-sdk");
    const info = await client.getAccountInfo(AccountAddress.fromBase58(account));
    return info.accountAmount.microCcdAmount;
  }

  /**
   * Submit a contract-update transaction built by an MCP builder tool.
   * `built` is the builder output: {contract_address, receive_name,
   * parameter_hex, suggested_energy}. Returns the tx hash after submission.
   * NOTE: this sends a REAL testnet transaction (test CCD only).
   */
  async submitUpdate(built) {
    const sdk = await import("@concordium/web-sdk");
    const client = await this.client();
    const sender = sdk.AccountAddress.fromBase58(this.account.address);
    const nonce = await client.getNextAccountNonce(sender);
    const tx = {
      type: sdk.AccountTransactionType.Update,
      header: {
        sender,
        nonce,
        expiry: sdk.TransactionExpiry.futureMinutes(30),
      },
      payload: {
        amount: sdk.CcdAmount.fromMicroCcd(0),
        address: sdk.ContractAddress.create(
          BigInt(built.contract_address.index),
          BigInt(built.contract_address.subindex)
        ),
        receiveName: sdk.ReceiveName.fromString(built.receive_name),
        message: sdk.Parameter.fromHexString(built.parameter_hex),
        maxContractExecutionEnergy: sdk.Energy.create(
          BigInt(built.suggested_energy ?? 30000)
        ),
      },
    };
    const signature = await sdk.signTransaction(tx, await this.signer());
    const hash = await client.sendAccountTransaction(tx, signature);
    return hash.toString();
  }

  async waitFinalized(txHash) {
    const client = await this.client();
    const { TransactionHash } = await import("@concordium/web-sdk");
    const summary = await client.waitForTransactionFinalization(
      TransactionHash.fromHexString(txHash)
    );
    return summary;
  }

  async register({ agentUri = null, metadataHashHex = null }) {
    const built = await buildRegisterPayload({
      sender: this.account.address,
      agentUri,
      metadataHashHex,
    });
    const txHash = await this.submitUpdate(built);
    const summary = await this.waitFinalized(txHash);
    if (summary.type !== "success") {
      throw new Error(`Register transaction rejected on chain: ${JSON.stringify(summary)}`);
    }
    // The register call mints a new token id; find it as the owner's newest agent.
    const owned = await liveAgentsByOwner(this.account.address);
    const agents = owned.agents ?? owned ?? [];
    if (!agents.length) {
      throw new Error(
        `Register tx ${txHash} finalized but no agent found for owner ${this.account.address}. ` +
          `Check https://testnet.ccdscan.io/transaction/${txHash}`
      );
    }
    const newest = agents.reduce((a, b) =>
      (a.token_id ?? a.tokenId) > (b.token_id ?? b.tokenId) ? a : b
    );
    const tokenId = newest.token_id ?? newest.tokenId;
    const badge = await tokenIdToBadge(tokenId);
    return { tokenId, badge, txHash, agent: newest };
  }

  async setAgentUri(tokenId, { agentUri = null, metadataHashHex = null }) {
    const built = await buildSetAgentUriPayload({
      sender: this.account.address,
      tokenId,
      agentUri,
      metadataHashHex,
    });
    const txHash = await this.submitUpdate(built);
    await this.waitFinalized(txHash);
    return { txHash, agent: await liveAgentOf(tokenId) };
  }

  async setMetadata(tokenId, { key, valueHex }) {
    const built = await buildSetMetadataPayload({
      sender: this.account.address,
      tokenId,
      key,
      valueHex,
    });
    const txHash = await this.submitUpdate(built);
    await this.waitFinalized(txHash);
    return { txHash };
  }

  async getMetadata(tokenId, key) {
    return liveGetMetadata(tokenId, key);
  }

  async setExternalReference(tokenId, { externalReference }) {
    const built = await buildSetExternalReferencePayload({
      sender: this.account.address,
      tokenId,
      externalReference,
    });
    const txHash = await this.submitUpdate(built);
    await this.waitFinalized(txHash);
    return { txHash, agent: await liveAgentOf(tokenId) };
  }

  async cis8Register({ externalKey, proof, metadata = [] }) {
    const built = await buildCis8RegisterPayload({
      sender: this.account.address,
      externalKey,
      proof,
      metadata,
    });
    const txHash = await this.submitUpdate(built);
    await this.waitFinalized(txHash);
    return { txHash };
  }

  async transfer({ to, amountMicroCcd, memo = null }) {
    const sdk = await import("@concordium/web-sdk");
    const client = await this.client();
    const sender = sdk.AccountAddress.fromBase58(this.account.address);
    const nonce = await client.getNextAccountNonce(sender);
    const base = {
      header: { sender, nonce, expiry: sdk.TransactionExpiry.futureMinutes(30) },
    };
    let tx;
    if (memo) {
      const memoBytes = new TextEncoder().encode(memo);
      if (memoBytes.length > 256) {
        throw new Error("Transfer memo must be at most 256 bytes.");
      }
      tx = {
        ...base,
        type: sdk.AccountTransactionType.TransferWithMemo,
        payload: {
          amount: sdk.CcdAmount.fromMicroCcd(BigInt(amountMicroCcd)),
          toAddress: sdk.AccountAddress.fromBase58(to),
          memo: new sdk.DataBlob(memoBytes.buffer),
        },
      };
    } else {
      tx = {
        ...base,
        type: sdk.AccountTransactionType.Transfer,
        payload: {
          amount: sdk.CcdAmount.fromMicroCcd(BigInt(amountMicroCcd)),
          toAddress: sdk.AccountAddress.fromBase58(to),
        },
      };
    }
    const signature = await sdk.signTransaction(tx, await this.signer());
    const hash = await client.sendAccountTransaction(tx, signature);
    const txHash = hash.toString();
    await this.waitFinalized(txHash);
    return {
      txHash,
      from: this.account.address,
      to,
      amountMicroCcd: BigInt(amountMicroCcd),
      memo,
      at: new Date().toISOString(),
    };
  }

  async agentOf(tokenId) {
    return liveAgentOf(tokenId);
  }

  async agentsByOwner(ownerAccount) {
    const res = await liveAgentsByOwner(ownerAccount);
    return res.agents ?? res ?? [];
  }

  async listAgents(offset = 0, limit = 20) {
    return liveListAgents(offset, limit);
  }
}

// --- Factory -----------------------------------------------------------------
/** Build the chain for the requested mode. Testnet mode throws TestnetKeyMissingError without a key. */
export function createChain(mode, statePath = null) {
  if (mode === "testnet") return new TestnetConcordiumChain();
  if (mode === "mock") return new MockConcordiumChain(statePath);
  throw new Error(`Unknown chain mode "${mode}" (expected "mock" or "testnet").`);
}
