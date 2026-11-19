// agent-card.js — ERC-8004 / A2A Agent Card generation + SHA-256 hashing.
//
// The card is the agent's published identity document. Its exact served
// bytes are hashed (SHA-256) and the hash is pinned on-chain via the
// CIS-8004 `setAgentURI` / `register` call, so any tampering with the card
// is detectable by comparing the fetched bytes against the on-chain
// metadata_hash.
//
// Shape: modelled on a REAL valid testnet card (token 1211, verified live
// 19 Nov 2026) and on the badge spec:
//   https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/concordium-badge.html
//
// Two-pass flow (per the docs): before registration the badge extension
// carries "tokenAddress": null and no verifyUrl; after `register` mints the
// token, the card is rebuilt with the real badge (via the MCP
// build_agent_badge tool or buildAgentCard with tokenId/badge) and the new
// hash is pinned with setAgentURI.

import { createHash } from "node:crypto";
import {
  BADGE_EXTENSION_URI,
  TESTNET_CAIP2,
  CIS8004_CONTRACT,
  CIS8_CONTRACT,
  MCP_URL,
  badgeToCaip19,
} from "./concordium.js";

export const AGENT_CARD_URL =
  "https://tiannuryadins.github.io/tickr-verified/agent-card.json";
export const AGENT_NAME = "TICKR Verified";
export const AGENT_VERSION = "1.0.0";
export const REPO_URL = "https://github.com/Tiannuryadins/tickr-verified";

export const TICKR_SKILLS = [
  {
    id: "analyze-tokenized-stocks",
    name: "Analyze tokenized stocks",
    description:
      "Scores Coinbase tokenized stocks by published transparent rules (NAV freshness, supply depth, drift vs last snapshot) and emits BUY/HOLD/AVOID signals with reasons.",
    tags: ["research", "tokenized-stocks", "transparent-rules"],
  },
  {
    id: "paper-trade-with-reason-hash",
    name: "Paper-trade with reason hash",
    description:
      "Paper-trades at NAV reference prices and logs each decision plus a keccak256 hash of its reasoning text, first to the Base Sepolia TradeJournal and then to the Concordium accountability log.",
    tags: ["paper-trading", "accountability", "base-sepolia"],
  },
  {
    id: "verify-concordium-badge",
    name: "Verify a Concordium badge",
    description:
      "Resolves a Verified by Concordium badge on-chain (owner, Active status) and checks the Agent Card SHA-256 against the on-chain metadata_hash.",
    tags: ["verification", "concordium-badge", "cis-8004"],
  },
];

export const TICKR_DESCRIPTION =
  "TICKR is a transparent rule-based agent that paper-trades Coinbase " +
  "tokenized stocks on Base Sepolia. Every decision carries its reasons and a " +
  "keccak256 hash of the reasoning text. This Concordium layer adds what the " +
  "public Base journal cannot: a verified identity. TICKR registers in the " +
  "Concordium Agent Registry (CIS-8004) for a Verified by Concordium badge, " +
  "binds its Base agent key via CIS-8, and anchors every decision in an " +
  "on-chain accountability log on Concordium testnet — so anyone can verify " +
  "WHICH agent made a decision and that a verified human stands behind it. " +
  "Testnet only; paper trading; not investment advice.";

/** SHA-256 of a string or Uint8Array, as 64 lowercase hex chars. */
export function sha256Hex(input) {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Build the Concordium badge A2A extension params.
 * Pre-registration: tokenAddress/owner/agentWallet are null (per the badge
 * spec's two-pass flow) and there is no verifyUrl yet — never a fake badge.
 * Post-registration: pass tokenId + badge + ownerAccount for the real block.
 */
export function badgeExtensionParams({ tokenId = null, badge = null, ownerAccount = null, agentWallet = null }) {
  const params = {
    tokenAddress: badge ? badgeToCaip19(badge) : null,
    owner: { account: ownerAccount ? `${TESTNET_CAIP2}:${ownerAccount}` : null },
    agentWallet: agentWallet
      ? `${TESTNET_CAIP2}:${agentWallet}`
      : ownerAccount
        ? `${TESTNET_CAIP2}:${ownerAccount}`
        : null,
    contracts: {
      cis8004: `${TESTNET_CAIP2}:${CIS8004_CONTRACT.index}.${CIS8004_CONTRACT.subindex}`,
      cis8: `${TESTNET_CAIP2}:${CIS8_CONTRACT.index}.${CIS8_CONTRACT.subindex}`,
    },
    verify:
      "Resolve tokenAddress via CIS-8004 agent_of; confirm owner + status=Active + card SHA-256 == metadata_hash.",
    verification: {
      service: "Concordium Agent Registry",
      mcp: MCP_URL,
      docs: "https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/concordium-badge.html",
    },
  };
  if (badge) {
    params.verification.verifyUrl = `https://agent-registry-mcp.concordium.com/v1/badge-check/${badge}`;
  }
  return params;
}

export function badgeExtension(opts) {
  return {
    uri: BADGE_EXTENSION_URI,
    description:
      "Verified by Concordium badge — on-chain agent identity in a CIS-8004 registry",
    required: false,
    params: badgeExtensionParams(opts),
  };
}

/**
 * Build the full TICKR Agent Card. `opts`:
 *   agentUri     — public URL where the card is hosted (default AGENT_CARD_URL)
 *   ownerAccount — Concordium account that owns/will own the agent NFT (null pre-registration)
 *   tokenId      — on-chain CIS-8004 token id (null pre-registration)
 *   badge        — short-form badge string (null pre-registration)
 *   agentWallet  — payment wallet (defaults to ownerAccount)
 */
export function buildAgentCard({
  agentUri = AGENT_CARD_URL,
  ownerAccount = null,
  tokenId = null,
  badge = null,
  agentWallet = null,
} = {}) {
  const card = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: AGENT_NAME,
    description: TICKR_DESCRIPTION,
    url: agentUri,
    version: AGENT_VERSION,
    provider: {
      organization: "TICKR",
      url: REPO_URL,
    },
    capabilities: {
      extensions: [
        badgeExtension({ tokenId, badge, ownerAccount, agentWallet }),
      ],
    },
    role: "trader",
    skills: TICKR_SKILLS,
    active: true,
    x402Support: false,
    registrations:
      tokenId !== null
        ? [
            {
              agentId: tokenId,
              agentRegistry: `${TESTNET_CAIP2}:${CIS8004_CONTRACT.index}.${CIS8004_CONTRACT.subindex}`,
            },
          ]
        : [],
  };
  return card;
}

/** Canonical card bytes: JSON with 2-space indent + trailing newline (the bytes that get hashed + hosted). */
export function cardToBytes(card) {
  return JSON.stringify(card, null, 2) + "\n";
}

/** SHA-256 of the canonical card bytes — the value pinned on-chain as metadata_hash. */
export function cardHash(card) {
  return sha256Hex(cardToBytes(card));
}
