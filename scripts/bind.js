#!/usr/bin/env node
// scripts/bind.js — bind the TICKR agent's Base (EVM) identity to its
// Concordium account via CIS-8, and attach it as the agent's
// external_reference in CIS-8004.
//
// Flow:
//   1. Resolve the EVM key: the TICKR Base deployer key
//      (~/.config/base-stocks-maxxing-deployer.key, testnet-only throwaway)
//      — its address MUST match 0x822bbE7174FC3E54cc278AD35dDE6532b2F8415B,
//      otherwise the script aborts. With --fresh-key, a NEW throwaway EVM
//      keypair is generated instead (stored mode-600 outside the repo in
//      testnet mode; in-memory only in mock mode).
//      The key is NEVER printed, copied, or committed — it is only passed
//      to the signing call.
//   2. Get the CIS-8 canonical bytes from the MCP service
//      (build_cis8_canonical_bytes) and sign them with ethereum-personal-sign.
//   3. Build + submit the CIS-8 register payload (mock: recorded locally;
//      testnet: real tx via the SDK).
//   4. Attach the binding as the agent's external_reference (CIS-8004
//      setExternalReference). NOTE: the MCP tool docs warn the Cis10
//      external_reference variant currently rejects on live testnet — if
//      step 4 fails on testnet, the CIS-8 binding itself still stands and
//      the failure is reported honestly instead of faked.

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
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
  buildCis8CanonicalBytes,
  buildCis8RegisterPayload,
  CIS8_CONTRACT,
} from "../src/concordium.js";
import {
  privateKeyToAddress,
  signPersonalMessage,
  verifyPersonalSignature,
} from "../src/evm-sign.js";

export const TICKR_DEPLOYER_ADDRESS = "0x822bbE7174FC3E54cc278AD35dDE6532b2F8415B";
export const TICKR_DEPLOYER_KEY_FILE = join(
  homedir(),
  ".config",
  "base-stocks-maxxing-deployer.key"
);
export const FRESH_KEY_FILE = join(
  homedir(),
  ".config",
  "concordium-trusted-agents",
  "tickr-evm-throwaway.key"
);
// The TICKR agent lives on Base Sepolia (chain 84532).
export const EXTERNAL_NAMESPACE = "eip155:84532";
export const EXTERNAL_KEY_TYPE = "secp256k1-uncompressed";
export const PROOF_SCHEME = "ethereum-personal-sign";

const { flags } = parseArgs(process.argv.slice(2));

if (flags.help) {
  printHelp(
    "bind.js — bind TICKR's Base EVM key to its Concordium account (CIS-8).",
    "node scripts/bind.js [--mode mock|testnet] [--token-id <id>] [--fresh-key] [--evm-key-file <path>] [--json]",
    `  --mode mock|testnet   Chain mode (default: mock).
  --token-id <id>       Agent token id (default: saved registration).
  --fresh-key           Generate a fresh throwaway EVM keypair instead of
                        using the TICKR deployer key.
  --evm-key-file <path> EVM private key file (default: ${TICKR_DEPLOYER_KEY_FILE}).
  --json                Print the result as JSON only.`
  );
  process.exit(0);
}

const mode = resolveMode(flags);
const tokenId = resolveTokenId(flags);
const chain = getChain(mode);
const owner = chain.getOwnerAccount();

// --- Resolve the EVM key (never printed) -------------------------------------
let privateKeyHex;
let keySource;
if (flags["fresh-key"]) {
  privateKeyHex = randomBytes(32).toString("hex");
  keySource = "fresh throwaway keypair (generated now)";
  if (mode === "testnet") {
    mkdirSync(join(homedir(), ".config", "concordium-trusted-agents"), {
      recursive: true,
    });
    writeFileSync(FRESH_KEY_FILE, privateKeyHex + "\n", { mode: 0o600 });
    chmodSync(FRESH_KEY_FILE, 0o600);
  }
} else {
  const keyFile = flags["evm-key-file"] ?? TICKR_DEPLOYER_KEY_FILE;
  if (!existsSync(keyFile)) {
    fail(
      `EVM key file not found: ${keyFile}\n` +
        `Re-run with --fresh-key to generate a fresh throwaway EVM keypair instead.`
    );
  }
  // The file holds a hex private key, optionally 0x-prefixed. The value is
  // never printed; only the derived address is ever shown.
  let rawKey = readFileSync(keyFile, "utf8").trim();
  if (rawKey.startsWith("0x") || rawKey.startsWith("0X")) rawKey = rawKey.slice(2);
  privateKeyHex = rawKey;
  if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
    fail(`EVM key file ${keyFile} does not contain a 64-hex-char private key.`);
  }
  keySource = `TICKR deployer key file (${keyFile})`;
}

const evmAddress = privateKeyToAddress(privateKeyHex);
if (!flags["fresh-key"] && evmAddress.toLowerCase() !== TICKR_DEPLOYER_ADDRESS.toLowerCase()) {
  fail(
    `EVM key file does not match the TICKR deployer address.\n` +
      `Derived address: ${evmAddress}\n` +
      `Expected:        ${TICKR_DEPLOYER_ADDRESS}\n` +
      `Refusing to bind a key that is not the TICKR agent's Base identity.`
  );
}

if (mode === "mock") {
  console.log("MOCK MODE — no real transaction will be submitted.");
} else {
  console.log(`TESTNET MODE — binding as Concordium account ${owner}.`);
}
console.log(`Agent token id: ${tokenId}`);
console.log(`EVM key source: ${keySource}`);
console.log(`EVM address:    ${evmAddress} (derived from key; key never printed)`);

const externalKey = {
  namespace: EXTERNAL_NAMESPACE,
  key_type: EXTERNAL_KEY_TYPE,
  // For ethereum-personal-sign the registry recovers an address, so the
  // public key is recorded as the 20-byte address hex (40 chars).
  public_key_hex: evmAddress.slice(2).toLowerCase(),
};

// --- Step 1: canonical bytes --------------------------------------------------
// Testnet mode: the exact bytes come from the MCP service (they embed the
// real Concordium account + testnet genesis hash). Mock mode: the mock
// account is not a real Base58Check Concordium address, so the MCP service
// rejects it — instead we build clearly-labelled mock canonical bytes
// locally. The live MCP path is covered by tests/payload-builders.test.js.
let canonical;
let canonicalBytes;
if (mode === "mock") {
  console.log("\n[1/4] Mock mode: building mock CIS-8 canonical bytes locally");
  console.log("      (the live MCP call needs a real Concordium account; the");
  console.log("      live path is covered by tests/payload-builders.test.js).");
  canonicalBytes = Buffer.from(
    `MOCK-CIS-8-CANONICAL:${owner}:${evmAddress}`,
    "utf8"
  );
  canonical = {
    byte_length: canonicalBytes.length,
    bytes_hex: canonicalBytes.toString("hex"),
    prefix_utf8: "MOCK-CIS-8-CANONICAL",
  };
} else {
  console.log("\n[1/4] Requesting CIS-8 canonical bytes from the MCP service...");
  canonical = await buildCis8CanonicalBytes({
    concordiumAccount: owner,
    externalNamespace: EXTERNAL_NAMESPACE,
    externalKeyType: EXTERNAL_KEY_TYPE,
    externalPublicKeyHex: externalKey.public_key_hex,
    proofScheme: PROOF_SCHEME,
  });
  canonicalBytes = Buffer.from(canonical.bytes_hex, "hex");
}
console.log(`      canonical bytes: ${canonical.byte_length} bytes, prefix "${canonical.prefix_utf8}"`);

// --- Step 2: sign with the EVM key --------------------------------------------
console.log("[2/4] Signing canonical bytes with ethereum-personal-sign...");
const { signatureHex, signerAddress } = signPersonalMessage(canonicalBytes, privateKeyHex);
if (signerAddress.toLowerCase() !== evmAddress.toLowerCase()) {
  fail("Internal error: signature signer does not match the EVM address.");
}
if (!verifyPersonalSignature(canonicalBytes, signatureHex, evmAddress)) {
  fail("Internal error: self-verification of the CIS-8 proof signature failed.");
}
console.log("      signature verified locally (recovered signer == EVM address).");

// --- Step 3: CIS-8 register ---------------------------------------------------
console.log("[3/4] Building + submitting the CIS-8 register payload...");
const proof = { scheme: PROOF_SCHEME, signature_hex: signatureHex };
if (mode === "testnet") {
  const built = await buildCis8RegisterPayload({
    sender: owner,
    externalKey,
    proof,
    metadata: [
      { key: "agent", value: "TICKR Verified" },
      { key: "origin", value: "Base Sepolia TradeJournal agent" },
    ],
  });
  console.log(`      payload: ${built.receive_name} on <${built.contract_address.index}, ${built.contract_address.subindex}>`);
} else {
  console.log("      mock mode: payload building skipped (mock sender is not a real account);");
  console.log("      the binding is recorded directly on the mock chain.");
}
const cis8 = await chain.cis8Register({
  sender: owner,
  externalKey,
  proof,
  metadata: [
    { key: "agent", value: "TICKR Verified" },
    { key: "origin", value: "Base Sepolia TradeJournal agent" },
  ],
});
console.log(`      CIS-8 binding recorded. tx: ${cis8.txHash}`);

// --- Step 4: attach as external_reference -------------------------------------
console.log("[4/4] Attaching the binding as the agent's external_reference...");
const externalReference = {
  contract_address: { index: CIS8_CONTRACT.index, subindex: CIS8_CONTRACT.subindex },
  kind: "Cis8",
  key: externalKey,
};
let attach = null;
let attachError = null;
try {
  attach = await chain.setExternalReference(tokenId, {
    sender: owner,
    externalReference,
  });
  console.log(`      external_reference attached. tx: ${attach.txHash}`);
} catch (err) {
  attachError = err.message;
  console.log(
    `      ATTACH FAILED (known live-testnet caveat: the Cis10 external_reference ` +
      `variant currently rejects on the live registry): ${attachError}`
  );
  console.log(
    "      The CIS-8 binding itself (step 3) still stands and is independently verifiable."
  );
}

const result = {
  mode,
  tokenId,
  concordiumAccount: owner,
  evmAddress,
  keySource,
  externalKey,
  proofScheme: PROOF_SCHEME,
  cis8TxHash: cis8.txHash,
  externalReferenceAttached: attach !== null,
  externalReferenceTxHash: attach?.txHash ?? null,
  externalReferenceError: attachError,
};

if (flags.json) {
  printJson(result);
  process.exit(0);
}

console.log("\nBind complete.");
console.log(`  Concordium account: ${owner}`);
console.log(`  EVM address:        ${evmAddress}`);
console.log(`  CIS-8 tx:           ${cis8.txHash}`);
console.log(
  `  external_reference: ${attach ? `attached (${attach.txHash})` : "NOT attached — see caveat above"}`
);
