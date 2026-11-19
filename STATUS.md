# STATUS — TICKR Verified (Concordium × Encode Trusted Agents Hackathon)

**Last updated:** 19 Nov 2026, ~19:30 WIB. **Build state: complete locally, NOT registered on testnet yet.**

## One-line status

The full entry is built, tested (83/83), and runs end-to-end in mock mode. The live verification path is proven against real testnet data. **No badge, no on-chain log, and no testnet transaction exists yet** — that needs one human step (below).

## What works

| Piece | State |
|---|---|
| TICKR agent logic (vendored) | ✅ Works; 14 tests (scoring, sizing, portfolio) |
| Agent Card generation + SHA-256 | ✅ Works; 8 tests; `agent-card.json` is byte-identical to the generator |
| Badge encoding (CIS-2 token address) | ✅ Verified against 3 real live badges (tokens 0, 1204, 1211) |
| Accountability log (schema + verify) | ✅ Works; 6 tests; mock-chain round-trip verified |
| Mock chain (register/bind/log/pay/verify) | ✅ Works; 11 tests; full CLI flow run end-to-end |
| Payment demo (transfer + audit record) | ✅ Works in mock; 8 tests |
| Keccak-256 + secp256k1 sign/recover | ✅ Verified against @noble/hashes + the key-0x01 address vector; 8 tests |
| Badge verification (live REST + independent card-hash re-check) | ✅ Works against real testnet data (see below) |
| Payload building via MCP (register/setMetadata/setAgentURI/CIS-8) | ✅ Live-tested; 7 tests |
| Testnet mode (SDK signing + submitting) | ✅ Written against real SDK v12 API; signing path verified locally; **never submitted (no key)** |
| Demo page (`index.html`) | ✅ Static page; live badge check + mock log + card hash |
| Demo script (`scripts/demo.js`) | ✅ Full mock flow in one command |

## Test results

`npm test` → **83 tests, 83 pass, 0 fail, 0 skipped** (19 Nov 2026, ~19:30 WIB).

| File | Tests |
|---|---|
| tests/tickr-agent.test.js | 14 |
| tests/mock-chain.test.js | 11 |
| tests/badge.test.js | 9 |
| tests/agent-card.test.js | 8 |
| tests/evm-sign.test.js | 8 |
| tests/live.test.js | 8 (live testnet reads) |
| tests/payment.test.js | 8 |
| tests/payload-builders.test.js | 7 (live MCP payload building) |
| tests/accountability.test.js | 6 |
| tests/testnet-mode.test.js | 4 |
| **Total** | **83** |

## What was live-tested against testnet (19 Nov 2026, no key needed)

All of these ran from this VM against the real testnet and are recorded in the tests above:

- **MCP health + handshake:** `/healthz` → `{"ok":true}`; `initialize` OK.
- **network_status:** testnet at block 51,016,077 via `grpc.testnet.concordium.com:20000`.
- **contract_info:** CIS-8004 `<12802, 0>`, CIS-8 `<12801, 0>`, standards CIS-0/CIS-2/CIS-8004.
- **list_agents:** 1,285 total agents on testnet.
- **Badge verification (real):** badge `JyP9XR6EkrzHnx9g177u9` (token 1211) verified VALID — owner `4j6RhVCWEG3GDQcwcgSQRxu7nmXSC4V834YrsVtudomCG6ueMH`, Active, card HTTP 200, fetched SHA-256 == on-chain hash `19f65f46…`. Verified both via REST and by an independent fetch+hash in our own script.
- **Invalid badge honestly detected:** token 0's badge (`JyP9TtQC3HCNrTYR3sc2T`) reports `badge_valid: false` (card URL 404s) while its on-chain record still resolves — the verifier distinguishes valid from invalid.
- **Payload building:** `build_register`, `build_set_metadata` (with a real `tickr.log.000001` key), `build_set_agent_uri`, `build_cis8_canonical_bytes` (206 bytes, prefix `CIS-8/v1/canonical`, testnet genesis hash `4221332d…f796`), `build_cis8_register` — all returned sign-ready payloads. **Nothing was submitted.**
- **Badge encoding:** SDK `tokenAddressToBase58` reproduces the three live badges exactly.
- **SDK signing path (local, no submission):** built + signed + serialized a Transfer and an Update (register) transaction with `@concordium/web-sdk` v12.0.3 — works.

## What is mock-only (NOT real)

- The mock chain (`MockConcordiumChain`): registration, CIS-8 binding, log entries, transfers, badges (token ids 900000+, badges like `JyP9WvKdLrfKq3NvoaBAZ`). All mock tx hashes start with `mock-`; all mock accounts start with `MOCK-`.
- The demo page's accountability log section (labelled MOCK).
- The CIS-8 canonical bytes in mock-mode `bind.js` (locally built, `MOCK-CIS-8-CANONICAL` prefix) — the MCP service rejects the mock account, correctly, because it isn't a real Concordium address. The live MCP path is covered by `tests/payload-builders.test.js`.

## Unblock step — real testnet registration (human, ~10 min, free)

One human step unblocks everything real. It cannot be done by the agent (Browser Wallet + identity creation):

1. **Install the Concordium Browser Wallet** (Chrome extension) from concordium.com.
2. **Create a testnet identity:** in the wallet, choose the **"Concordium testnet IP"** identity provider. On testnet no ID document is needed.
3. **Create a testnet account** in the wallet.
4. **Fund it:** in the wallet, Activity → "Request CCD" (faucet; 2,000–20,000 CCD, once per account). Or from a terminal: `curl -X PUT https://wallet-proxy.testnet.concordium.com/v0/testnetGTUDrop/<address>`.
5. **Export the account key:** wallet → account → Export (.export file). Save it as `~/.config/concordium-trusted-agents/testnet-account.export` and `chmod 600` it. **Never commit it, never share it.**
6. **Tell the agent** (or set it yourself): `export CONCORDIUM_KEY_FILE=~/.config/concordium-trusted-agents/testnet-account.export`

Then the agent runs (all free, test CCD only):

```bash
node scripts/register.js --mode testnet
node scripts/build-card.js --token-id <id> --badge <badge> --owner <account>
# host agent-card.json at the GitHub Pages URL, then:
node scripts/register.js --mode testnet --pin-only --token-id <id>
node scripts/bind.js --mode testnet
node scripts/log-decision.js --mode testnet --demo
node scripts/pay.js --mode testnet --to <counterparty-account> --direction decision-fee --amount 0.1
node scripts/verify-badge.js --badge <badge>
```

Until then, every `--mode testnet` command fails cleanly with: `testnet key not configured — see STATUS.md § Unblock step` (exit 1, no stack trace, no fake submission).

## Key decisions (and why)

- **CIS-8 external key = the TICKR Base deployer key** (`0x822bbE7174FC3E54cc278AD35dDE6532b2F8415B`). The key file exists at `~/.config/base-stocks-maxxing-deployer.key` (testnet-only throwaway). `bind.js` verified it live: the derived address matches the deployer address, and the personal-sign proof verifies locally. The key is never printed or committed; `--fresh-key` generates a fresh throwaway instead. (RESEARCH.md §5 suggested the OKX wallet — deliberately NOT used; it is off-limits.)
- **No fresh Concordium keypair was generated by the agent.** A Concordium account needs an identity from an Identity Provider; there is no documented fully-programmatic path, so the agent did not fabricate one. The key comes from the Browser Wallet export in the unblock step.
- **x402 is a stretch goal, not claimed.** No step-by-step testnet x402 tutorial was found. `agent-card.json` has `x402Support: false`. The payment demo is a real on-chain CCD transfer with a memo + audit record.
- **No own smart contract.** The registry contracts are already deployed; the entry calls them. No Rust needed.
- **Pure-JS crypto (keccak256 + secp256k1)** instead of adding ethers: zero extra dependencies, verified against @noble/hashes and the key-0x01 vector.

## Honest limitations

1. **Testnet mode has never submitted.** The signing/serialization path is verified locally, but the first real `register` submit is untested until a key exists. Possible first-run issues: nonce handling, energy estimates (MCP suggests 30,000), gRPC-web connectivity from this VM (the proxy may interfere with the gRPC client — reads go through MCP/REST, which work, but the SDK submit path uses gRPC directly).
2. **CIS-8 `external_reference` attach may reject on live testnet.** The MCP tool docs warn the Cis10 external-reference variant currently rejects on the live registry. The CIS-8 binding itself still stands and is verifiable; `bind.js` reports the attach result honestly either way.
3. **CIS-8 `public_key_hex` uses the 20-byte address hex** (the proof scheme recovers an address, so this is the natural form, and the canonical-bytes tool accepted it) — but the full `build_cis8_register` → submit → on-chain verify loop is untested until a key exists. If the registry wants the full uncompressed pubkey instead, `bind.js` needs a one-line change (`public_key_hex` → 65-byte pubkey) — flagged here, not hidden.
4. **Checkpoint 1 (22 Nov 23:59 UTC) needs the user's Encode Club account** — see CHECKPOINT-1-DRAFT.md. The platform action is user-only.
5. **Indonesia eligibility is very likely but not 100% confirmed** (no exclusion found; not explicitly named). Flag at Encode account creation.
6. **Demo video (≤3 min) and final submission are user-side steps** (deadline 9 Dec 23:59 UTC).

## Deadlines

- **Checkpoint 1:** Sun 22 Nov 2026 23:59 UTC (Mon 23 Nov 06:59 WIB) — create project + team + share idea on Encode. Draft ready: CHECKPOINT-1-DRAFT.md.
- **Final deadline:** Wed 9 Dec 2026 23:59 UTC (Thu 10 Dec 06:59 WIB) — description, public repo, demo video ≤3 min, CCDExplorer link, path-to-production plan.
- **Judging:** 10–11 Dec 2026.
- **Prize:** 3M CCD total (1M CCD ≈ $2,900–3,000 each for 1st/2nd/3rd) + eligibility for the 75M CCD Grants Program.
