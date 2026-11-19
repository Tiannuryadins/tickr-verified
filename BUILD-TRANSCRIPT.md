# BUILD TRANSCRIPT — TICKR Verified

Honest build log: what was built, when, how it was tested, what is real vs mocked. Built 19 Nov 2026 (~19:15–20:15 WIB) by a builder subagent from the research in RESEARCH.md. No repo was published, nothing was submitted, no account was created.

## Timeline (19 Nov 2026, WIB)

- **~19:15** — Read RESEARCH.md + the TICKR agent source (`~/workspace/base-stocks-maxxing/`). Confirmed Node v24.22.1, npm 10.9.4. Confirmed the TICKR deployer key file exists (mode 600, 66 bytes).
- **~19:20** — Live-tested the MCP service from this VM: `/healthz` OK, `initialize` OK, `network_status` (block 51,016,077), `contract_info` (CIS-8004 `<12802,0>`, CIS-8 `<12801,0>`), `list_agents` (1,285 total).
- **~19:25** — Found live badge fixtures: token 0 (badge `JyP9TtQC3HCNrTYR3sc2T`, card 404s → honestly invalid) and token 1211 (badge `JyP9XR6EkrzHnx9g177u9`, fully valid: HTTP 200, hash match, badge present). Fetched the real card for token 1211 and used it as the model for our Agent Card shape.
- **~19:30** — Live-tested payload builders: `build_register` (sign-ready `parameter_hex` + `suggested_energy` 30000), `build_set_metadata` (real `tickr.log.000001` key), `build_cis8_canonical_bytes` (206 bytes, testnet genesis hash `4221332d…f796`), `build_cis8_register`. Pulled `tools/list` (41 tools) for exact argument schemas — this caught two wrong guesses (set_metadata is single key/value, not an array; canonical-bytes takes flat args).
- **~19:35** — Installed `@concordium/web-sdk` v12.0.3 via npm (59 packages, 30s). Verified the v12 API surface from the installed `.d.ts` + live probes: `ConcordiumGRPCWebClient`, `buildBasicAccountSigner`, `signTransaction` (async), `serializeAccountTransactionForSubmission`, `Parameter.fromHexString`, `ReceiveName.fromString`, `tokenAddressToBase58`. Built + signed + serialized a Transfer and an Update transaction locally (no submission).
- **~19:40** — Verified badge encoding: SDK `tokenAddressToBase58` reproduces all three live badges exactly (tokens 0, 1204, 1211). Read the badge spec doc for the encoding formula + the pre-registration card convention (`tokenAddress: null`).
- **~19:45–20:00** — Wrote the code: `src/` (keccak, evm-sign, vendored tickr-agent, concordium chain layer, agent-card, accountability, payment), `scripts/` (register, bind, log-decision, pay, verify-badge, build-card, demo, lib), `agent-card.json` (generated), `tests/` (10 files), demo page.
- **~20:00** — First full test run: 80/83. Three failures, all real bugs or bad test data (see "Bugs found" below). Fixed; re-ran: **83/83 pass**.
- **~20:05** — Ran the full CLI flow in mock mode: register → bind (real deployer key file; derived address matched `0x822b…8415B`) → log-decision → pay → verify-badge. All green. Live `verify-badge.js` (default fixture) verified token 1211 VALID with an independent card-hash re-check.
- **~20:10** — Verified testnet mode fails cleanly without a key (clear message, exit 1, no stack trace) on register/bind/pay.
- **~20:15** — Wrote README, STATUS, SUBMISSION, this transcript, CHECKPOINT-1-DRAFT. Final `npm test`: 83/83.

## Bugs found and fixed during the build (all caught by tests, not by luck)

1. **Keccak Pi permutation was wrong.** My first PI table was the inverse permutation. Symptom: `keccak256("")` failed. Fixed by computing the table from the spec formula (`B[y, (2x+3y)%5]`). Verified against `@noble/hashes` on 5 inputs (empty, hello, abc, fox, 200-byte multi-block) — all match.
2. **My remembered keccak256("hello") vector was wrong.** I had `…319a75754b06b80` from memory (63 hex chars — impossible). The real value is `…319a09a7a36deac8` (confirmed by @noble/hashes). Lesson: never trust a remembered hash; cross-check with an independent implementation.
3. **Address comparison was case-sensitive.** My `privateKeyToAddress` returns lowercase; the known vector is EIP-55 checksummed. The value was right, the comparison was wrong — fixed to compare case-insensitively.
4. **Oversized-record test premise was wrong.** Long reason text doesn't grow the log record (only its 32-byte hash is stored — by design). Rewrote the test to use a huge symbol instead.
5. **`modInv` missed a default modulus** (crashed on the first `scalarMult` call). One-line fix.
6. **`signTransaction` is async** — my first SDK probe didn't await it and got an empty signature object. Caught by the probe, not by production code.
7. **`node --test tests/` doesn't work on Node 24** (treats the dir as a module). The test script uses `node --test tests/*.test.js`.
8. **Deployer key file is 0x-prefixed** (66 bytes). `bind.js` now strips an optional `0x` prefix. The key value was never printed.
9. **Mock account rejected by the MCP service** (not Base58Check — correct behaviour). `bind.js` mock mode now builds mock canonical bytes locally and skips the MCP calls; the live MCP path is covered by tests.
10. **Testnet fail-clean path threw a stack trace.** Added a clean uncaught-exception handler in `scripts/lib.js` (message + exit 1, no trace).

## What is real vs mocked

**Real (verified live, 19 Nov 2026):**
- Testnet node up, block 51,016,077; registry contracts `<12802,0>` / `<12801,0>`; 1,285 registered agents.
- Badge verification against live data (token 1211 VALID, token 0 honestly INVALID).
- Payload building for all five operations (register, setAgentURI, setMetadata, CIS-8 canonical bytes + register).
- Badge encoding (3 live badges reproduced exactly).
- SDK signing + serialization (local, no submission).
- Keccak256 + secp256k1 (cross-checked against @noble/hashes + the key-0x01 vector).
- CIS-8 proof flow up to the payload: canonical bytes (live) + personal-sign (local, verified) + register payload (live). The on-chain submit is the only untested step.
- Deployer key → address derivation matches the TICKR deployer address.

**Mock (labelled everywhere):**
- The mock chain and everything on it (agents, badges, log entries, transfers, tx hashes).
- The demo page's log section.
- Mock canonical bytes in mock-mode `bind.js`.

**Not done (needs the unblock step):**
- Testnet account creation, funding, key export (human).
- Real registration, badge, card re-pin, CIS-8 submit, log entries, payment.
- Repo publication, demo video, Encode Checkpoint 1 + final submission.

## Demo video shot list (for later)

1. The gap: Base journal entry vs "who logged this?" (15s)
2. `node scripts/register.js --mode testnet` + badge on the explorer (30s)
3. `node scripts/log-decision.js --mode testnet --demo` + `tickr.log` entry on CCDScan (30s)
4. `node scripts/verify-badge.js --badge …` — owner + Active + card hash match (30s)
5. `node scripts/pay.js --mode testnet …` — transfer + audit record (20s)
6. Close: verification chain diagram (15s)

## Files

- Code: `src/` (8 files, ~3,157 lines incl. scripts), `scripts/` (8 files), `tests/` (10 files, 1,398 lines).
- Docs: RESEARCH.md (pre-existing), README.md, STATUS.md, SUBMISSION.md, BUILD-TRANSCRIPT.md (this file), CHECKPOINT-1-DRAFT.md.
- Web: index.html, app.js, styles.css, agent-card.json.
- Config: package.json, package-lock.json, LICENSE (MIT), .gitignore.
- Working state (gitignored, from the CLI test run): `.mock-chain-state.json`, `.tickr-registration.json` (mock registration: token 900000, badge `JyP9WvKdLrfKq3NvoaBAZ`).
