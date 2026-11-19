// scripts/lib.js — shared CLI helpers for the TICKR Verified scripts.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createChain } from "../src/concordium.js";

// Clean failure for every script that imports this module: an uncaught
// error (e.g. the testnet key missing) prints its message and exits 1 —
// never a stack trace, never an obscure crash.
process.on("uncaughtException", (err) => {
  if (err?.code === "TESTNET_KEY_MISSING") {
    console.error(`\n${err.message}`);
  } else {
    console.error(`\nERROR: ${err?.message ?? err}`);
  }
  process.exit(1);
});

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MOCK_STATE_FILE = join(PROJECT_ROOT, ".mock-chain-state.json");
export const REGISTRATION_FILE = join(PROJECT_ROOT, ".tickr-registration.json");

/** Minimal --flag value / --flag=value / --bool parser. Returns { flags, positionals }. */
export function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[arg.slice(2)] = argv[++i];
      } else {
        flags[arg.slice(2)] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

export function printHelp(name, usage, options) {
  console.log(`Usage: ${usage}\n\n${name}\n\nOptions:\n${options}`);
}

export function fail(message, code = 1) {
  console.error(`\nERROR: ${message}`);
  process.exit(code);
}

/** Resolve --mode (default "mock"). */
export function resolveMode(flags) {
  const mode = flags.mode ?? "mock";
  if (mode !== "mock" && mode !== "testnet") {
    fail(`--mode must be "mock" or "testnet" (got "${mode}").`);
  }
  return mode;
}

/** Build the chain for the requested mode. Testnet mode fails cleanly without a key. */
export function getChain(mode) {
  const statePath = mode === "mock" ? MOCK_STATE_FILE : null;
  return createChain(mode, statePath);
}

/** Load the saved registration ({ tokenId, badge, txHash, mode }) if present. */
export function loadRegistration() {
  if (!existsSync(REGISTRATION_FILE)) return null;
  try {
    return JSON.parse(readFileSync(REGISTRATION_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function saveRegistration(reg) {
  writeFileSync(REGISTRATION_FILE, JSON.stringify(reg, null, 2) + "\n");
}

/** Resolve the token id: --token-id flag, else the saved registration. */
export function resolveTokenId(flags) {
  if (flags["token-id"]) return Number(flags["token-id"]);
  const reg = loadRegistration();
  if (reg?.tokenId != null) return Number(reg.tokenId);
  fail(
    "No agent token id. Pass --token-id <id> or run scripts/register.js first " +
      "(it saves the registration to .tickr-registration.json)."
  );
  return null; // unreachable
}

export function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}
