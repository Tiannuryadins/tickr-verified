#!/usr/bin/env node
// scripts/build-card.js — rebuild agent-card.json, optionally with the real
// badge after registration.
//
//   node scripts/build-card.js                        # pre-registration card (tokenAddress: null)
//   node scripts/build-card.js --token-id 1234 --badge JyP9... --owner 3xxx...
//
// The output is written to agent-card.json (or --out). After rebuilding with
// a badge, re-host the card and pin the new hash:
//   node scripts/register.js --mode testnet --pin-only --token-id <id>

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, printHelp, fail, printJson, PROJECT_ROOT } from "./lib.js";
import { buildAgentCard, cardToBytes, cardHash } from "../src/agent-card.js";

const { flags } = parseArgs(process.argv.slice(2));

if (flags.help) {
  printHelp(
    "build-card.js — rebuild agent-card.json (with or without a badge).",
    "node scripts/build-card.js [--token-id <id>] [--badge <badge>] [--owner <account>] [--agent-uri <url>] [--out <path>] [--json]",
    `  --token-id <id>     On-chain CIS-8004 token id (omit pre-registration).
  --badge <badge>       Badge short form (omit pre-registration).
  --owner <account>     Concordium owner account (omit pre-registration).
  --agent-uri <url>     Public card URL (default: the GitHub Pages URL).
  --out <path>          Output file (default: ./agent-card.json).
  --json                Print the card as JSON instead of writing a file.`
  );
  process.exit(0);
}

const tokenId = flags["token-id"] ? Number(flags["token-id"]) : null;
const badge = flags.badge ?? null;
const ownerAccount = flags.owner ?? null;
if ((tokenId === null) !== (badge === null)) {
  fail("--token-id and --badge must be given together (or both omitted).");
}
if (badge && !ownerAccount) {
  fail("--owner is required when --badge is given.");
}

const card = buildAgentCard({
  agentUri: flags["agent-uri"],
  ownerAccount,
  tokenId,
  badge,
  agentWallet: ownerAccount,
});
const bytes = cardToBytes(card);
const hash = cardHash(card);

if (flags.json) {
  printJson({ card, sha256: hash });
  process.exit(0);
}

const outPath = flags.out ?? join(PROJECT_ROOT, "agent-card.json");
writeFileSync(outPath, bytes);
console.log(`Wrote ${outPath}`);
console.log(`SHA-256 of served bytes: ${hash}`);
if (badge) {
  console.log(`Badge: ${badge} (token ${tokenId})`);
  console.log("Next: host this file, then pin the hash with:");
  console.log(`  node scripts/register.js --mode testnet --pin-only --token-id ${tokenId}`);
} else {
  console.log("Pre-registration card (tokenAddress: null) — no badge minted yet.");
}
