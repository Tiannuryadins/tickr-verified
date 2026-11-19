# TICKR Verified

**A transparent paper-trading agent, now with a verifiable identity.**

Entry for the [Concordium × Encode Club Trusted Agents Hackathon](https://www.encodeclub.com/programmes/concordium-trusted-agents-hackathon) — testnet only, free to enter, no real money anywhere.

## The idea in one paragraph

TICKR is a real, transparent rule-based agent that paper-trades Coinbase tokenized stocks: it scores tokens by published rules and logs every BUY/SELL decision — plus a keccak256 hash of its reasoning — to a public journal on Base Sepolia. But that journal is **unauthenticated**: anyone can log entries, and nothing proves *which* agent made a decision or that a verified human stands behind it. This entry closes that gap with Concordium: TICKR gets a **Verified by Concordium badge** (CIS-8004 Agent Registry), its Base key is bound via **CIS-8**, and every decision is anchored in an **on-chain accountability log** on Concordium testnet. Anyone can verify: decision → reason hash → Concordium log entry → verified badge → Agent Card.

## Status

**Built and tested locally, 19 Nov 2026. Not yet registered on testnet** — registration needs a Concordium testnet account, which is a one-time human step (Browser Wallet). See [STATUS.md](STATUS.md) for exactly what works, what was live-tested, and the unblock step. Nothing in this repo claims a testnet transaction that didn't happen.

- 83/83 tests pass (`npm test`), including 8 live testnet tests + 7 live payload-builder tests.
- Full flow runs end-to-end in mock mode: `node scripts/demo.js`.
- Live badge verification works today against real testnet data: `node scripts/verify-badge.js`.

## Quick start

```bash
npm install
npm test                    # 83 tests, incl. live testnet reads (skipped offline)
node scripts/demo.js        # full flow in mock mode: register -> bind -> log -> pay -> verify
```

Serve the demo page with any static server and open it:

```bash
python3 -m http.server 8000  # then open http://localhost:8000
```

## How it works

```
TICKR agent (vendored, src/tickr-agent.js)
  │  scores tokenized stocks by published rules, sizes paper trades
  ▼
Decision + reasons ──keccak256──▶ reason hash
  │                                   │
  │ (Base Sepolia, existing)          │ (Concordium testnet, this entry)
  ▼                                   ▼
TradeJournal contract         Accountability log: setMetadata
(public, unauthenticated)     tickr.log.<seq> on the agent's CIS-8004 token
                                      │
                              Badge (CIS-8004 NFT) ──▶ Agent Card (SHA-256 pinned)
                                      │
                              CIS-8 binding ──▶ Base deployer key 0x822b…8415B
```

### Concordium components used

| Component | How |
|---|---|
| **CIS-8004 Agent Registry** (`<12802, 0>` testnet) | Agent registration, badge (the NFT token address), `setAgentURI` card pinning, `setMetadata` accountability log |
| **CIS-8 External Key Registry** (`<12801, 0>` testnet) | Binds the agent's Base Sepolia key to its Concordium account via an ethereum-personal-sign proof; attached as `external_reference` |
| **Agent Registry MCP service** | Payload building (`build_register`, `build_set_metadata`, `build_cis8_*`), reads (`agent_of`, `list_agents`), REST badge checks — no auth, no key needed |
| **Concordium ID** | Every Concordium account is backed by an identity from an Identity Provider; on testnet the testnet IP issues identities without verification |
| **CCD payments** | On-chain testnet CCD transfer (with memo) between agent accounts + audit record |
| **x402** | Stretch goal only — NOT claimed. No step-by-step testnet x402 tutorial was found; `agent-card.json` honestly has `x402Support: false` |

## Repo layout

```
index.html, app.js, styles.css   Static demo page (badge check, log, card)
agent-card.json                  ERC-8004/A2A Agent Card (pre-registration: tokenAddress null)
src/tickr-agent.js               TICKR agent logic, vendored from the Base entry
src/concordium.js                Chain layer: mock + testnet modes, MCP client, payload builders
src/agent-card.js                Agent Card generation + SHA-256 hashing
src/accountability.js            Decision -> Concordium log record (schema + verification)
src/payment.js                   Agent payment demo (transfer + audit record)
src/keccak.js                    Pure-JS Keccak-256 (verified against @noble/hashes)
src/evm-sign.js                  Pure-JS secp256k1 sign/recover for the CIS-8 proof
scripts/register.js              Register the agent (mint the badge)
scripts/bind.js                  Bind the Base key via CIS-8
scripts/log-decision.js          Log a decision to the accountability log
scripts/pay.js                   Agent payment demo
scripts/verify-badge.js          Resolve + verify a badge (live or mock)
scripts/build-card.js            Rebuild agent-card.json (with badge, after registration)
scripts/demo.js                  Full end-to-end mock flow in one command
tests/                           node:test suite (83 tests)
RESEARCH.md                      Hackathon + testnet research (19 Nov 2026)
STATUS.md                        Build status, live-vs-mock, unblock step
SUBMISSION.md                    Submission draft (description + path to production)
BUILD-TRANSCRIPT.md              Honest build log
CHECKPOINT-1-DRAFT.md            Idea write-up for the 22 Nov checkpoint
```

## CLI usage

Every script takes `--mode mock|testnet` (default `mock`) and `--help`. Mock mode is fully offline and persists state in `.mock-chain-state.json` (gitignored). Testnet mode needs `CONCORDIUM_KEY_FILE` pointing at a mode-600 Browser Wallet export outside the repo, and fails cleanly without it.

```bash
node scripts/register.js --mode mock --reset        # register + mint mock badge
node scripts/bind.js --mode mock                    # CIS-8 bind (TICKR deployer key)
node scripts/log-decision.js --mode mock --demo     # log a demo decision
node scripts/pay.js --mode mock --decision-seq 1    # pay 1 CCD for the signal
node scripts/verify-badge.js --mode mock --token-id 900000
node scripts/verify-badge.js                        # live: verify a real testnet badge
```

Testnet mode (after the unblock step in STATUS.md):

```bash
export CONCORDIUM_KEY_FILE=~/.config/concordium-trusted-agents/testnet-account.export
node scripts/register.js --mode testnet
node scripts/build-card.js --token-id <id> --badge <badge> --owner <account>
# host the card, then pin the new hash:
node scripts/register.js --mode testnet --pin-only --token-id <id>
node scripts/bind.js --mode testnet
node scripts/log-decision.js --mode testnet --demo
node scripts/pay.js --mode testnet --to <account> --direction decision-fee --amount 0.1
node scripts/verify-badge.js --badge <badge>
```

## Accountability log schema

On-chain, via CIS-8004 `setMetadata` on the agent token (full spec in `src/accountability.js`):

- Key `tickr.log.<seq>` (e.g. `tickr.log.000001`), value = hex of compact JSON:
  `{"v":1,"d":"BUY","s":"B20","q":21896,"p":45670000,"h":"0x…","t":"…","b":"<badge>","j":"<base tx>|null"}` — ≤ 512 bytes.
- Key `tickr.log.head` = latest sequence number, for discovery in one read.
- Verification: recompute `keccak256(reasoning text)` → must equal `h`; read the entry via `get_metadata`; resolve the badge (owner + Active + card SHA-256 == on-chain `metadata_hash`).

## Keys and safety

- **No keys in this repo, ever.** `.gitignore` blocks `*.export`, `*.key`, `*.pem`, `.env`.
- The Concordium testnet key (when created) lives in `~/.config/concordium-trusted-agents/` mode 600, loaded only via `CONCORDIUM_KEY_FILE`.
- The CIS-8 proof uses the TICKR Base deployer key (`~/.config/base-stocks-maxxing-deployer.key`, testnet-only throwaway). `bind.js` reads it only to sign, verifies the derived address matches `0x822bbE7174FC3E54cc278AD35dDE6532b2F8415B`, and never prints it. `--fresh-key` generates a fresh throwaway instead.
- Mock mode labels everything MOCK and never claims a real transaction.

## Honest limitations

- **Not registered yet.** No badge, no on-chain log entries, no testnet transactions exist until the unblock step (STATUS.md) is done.
- **Testnet mode is written against the real SDK v12 API and the signing path is verified locally, but no testnet transaction has been submitted yet** — the first real submit is untested by definition until a key exists.
- **CIS-8 `external_reference` attach may reject on live testnet.** The MCP tool docs warn the Cis10 variant currently rejects on the live registry. The CIS-8 binding itself still stands; `bind.js` reports the attach result honestly either way.
- **x402 is not implemented** (stretch goal; see SUBMISSION.md).
- **NAV coverage is thin** (only ~12 of 377 tokenized stocks publish a live NAV) — a data limitation inherited from TICKR, stated openly.

## License

MIT — see [LICENSE](LICENSE).
