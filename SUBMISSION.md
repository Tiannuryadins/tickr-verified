# SUBMISSION DRAFT — TICKR Verified

For the Concordium × Encode Club Trusted Agents Hackathon. Final deadline: **Wed 9 Dec 2026 23:59 UTC**. Submit from the project page on the Encode platform. Items marked **[PENDING]** need the unblock step (STATUS.md) or the user; nothing here claims a result that doesn't exist yet.

## Project description

**TICKR Verified — a transparent agent, now verifiable.**

TICKR is a real, transparent rule-based agent that paper-trades Coinbase tokenized stocks on Base Sepolia. It scores tokens by published rules (NAV freshness, supply depth, drift), sizes paper trades, and logs every decision — plus a keccak256 hash of its reasoning text — to a public on-chain journal. The problem: that journal is public and *unauthenticated*. Anyone can log entries; nothing proves *which* agent made a decision, or that a verified human stands behind it.

TICKR Verified closes that gap with Concordium:

1. **Verified identity (CIS-8004).** TICKR is registered in the Concordium Agent Registry on testnet and carries a **Verified by Concordium badge** — its CIS-8004 NFT token. Its ERC-8004/A2A Agent Card is hosted publicly and its SHA-256 is pinned on-chain, so the card cannot be swapped without the chain revealing it.
2. **Cross-chain binding (CIS-8).** The agent's existing Base Sepolia key is cryptographically bound to its Concordium account with an ethereum-personal-sign proof and attached as the agent's `external_reference` — the same agent, now anchored to Concordium identity.
3. **Verifiable accountability log.** Every TICKR decision (BUY/SELL/HOLD + reasons + reason hash) is anchored as a `setMetadata` entry on the agent token: `tickr.log.<seq>`. Anyone can verify the full chain with no key: decision → reason hash → Concordium log entry → verified badge → Agent Card.
4. **Agent payments.** An on-chain testnet CCD transfer between agent accounts with a memo + audit record linking the payment to the badge and to a logged decision — a counterparty pays for a verified signal, or the agent pays a small fee per verified decision.

## How it works

- The TICKR agent (vendored, zero-dependency, same code as the Base entry) analyses tokenized stocks and emits decisions with reasons.
- Each decision's reasoning text is hashed (keccak256 — the same hash the Base journal uses, so one hash anchors the decision on both chains).
- The decision record is written to the Concordium accountability log (`tickr.log.<seq>`, ≤512 bytes, plus a `tickr.log.head` pointer) via the Agent Registry MCP's `build_set_metadata` payload, signed and submitted with `@concordium/web-sdk`.
- Verification is trustless and keyless: resolve the badge via `agent_of` (owner + Active status), fetch the Agent Card and check its SHA-256 against the on-chain `metadata_hash`, read the log entry via `get_metadata`, recompute the reason hash.
- The demo page and CLI scripts (`register`, `bind`, `log-decision`, `pay`, `verify-badge`) run the whole flow; a mock mode mirrors the real interfaces for offline testing.

## Concordium components used

- **CIS-8004 Agent Registry** (testnet `<12802, 0>`) — registration, badge, `setAgentURI`, `setMetadata` log.
- **CIS-8 External Key Registry** (testnet `<12801, 0>`) — cross-chain key binding + `external_reference`.
- **Agent Registry MCP service** (+ REST twins) — payload building and keyless reads/verification.
- **Concordium ID** — the agent's owner account is backed by an Identity Provider identity (testnet IP, no verification needed on testnet).
- **CCD payments** — on-chain testnet transfers with memos + audit records.
- x402: **not claimed** — stretch goal (see Path to production).

## Repository

**[PENDING — publish after the unblock step]**

Planned: `https://github.com/Tiannuryadins/tickr-verified` (public, MIT). The repo is self-contained: vendored TICKR agent, chain layer, Agent Card, demo page, 83 tests.

Demo page (GitHub Pages, planned): `https://tiannuryadins.github.io/tickr-verified/`

## Demo video (≤3 min)

**[PENDING — user records after testnet registration]**

Planned shots (script in BUILD-TRANSCRIPT.md):
1. The gap: Base journal entry vs "who logged this?" (15s)
2. Register + badge on testnet explorer (30s)
3. Log a decision, show the `tickr.log` entry on CCDScan (30s)
4. Verify the badge live: owner + Active + card hash match (30s)
5. Pay for a signal: transfer + audit record (20s)
6. Close: verification chain diagram (15s)

## CCDExplorer link

**[PENDING — real link after testnet registration]**

Planned: the agent's registry entry / a log-entry transaction on the testnet explorer, e.g. `https://testnet.ccdscan.io/contract/12802/0` (token page) and the registration transaction URL. Until registration, the live verification demo resolves a real existing agent (token 1211, badge `JyP9XR6EkrzHnx9g177u9`).

## Path to production

What it would take to go live on mainnet, in front of real users:

1. **Mainnet identity (the real trust upgrade).** On testnet the identity is unverified by design. On mainnet, the human behind TICKR verifies once with a real Identity Provider (passport/liveness in the wallet). The badge then proves a *verified human* stands behind the agent — the core value proposition — without revealing who (attribute proofs are zero-knowledge).
2. **Mainnet registration.** Same flow, mainnet registry (`<10082, 0>` / `<10081, 0>`). Registration is free on mainnet via sponsored transactions. Re-host the Agent Card at its production URL, re-pin the hash, re-bind the production agent key via CIS-8.
3. **Real-money guardrails before any real trading.** TICKR is a paper-trading agent; going live with real funds would need: exchange/broker integration with real execution (not NAV reference prices), position limits and kill-switches, and a compliance review (tokenized stocks are not available to U.S. persons — the existing geo-gate stays). The accountability log itself is chain-agnostic and ports unchanged.
4. **x402 agent payments.** Replace the plain-transfer demo with x402: the agent sells verified signals over HTTP with x402 settlement on Concordium, using sponsored transactions so counterparties never hold CCD. The facilitator setup is the remaining research item (no step-by-step testnet tutorial was found during the hackathon).
5. **Log economics.** Each decision is one `setMetadata` transaction (~€0.01 on mainnet). At scale, batch decisions into periodic anchor transactions (e.g. one Merkle-root anchor per hour) while keeping per-decision hashes verifiable off-chain.
6. **Monitoring + revocation.** A watchdog that re-verifies the badge and card hash continuously and revokes the agent token if the operator key is compromised; the registry's `revoke` entrypoint is already supported by the chain layer.
7. **Multi-chain agents.** The CIS-8 binding pattern extends to the agent's keys on other chains (Solana, etc.) — one Concordium identity anchoring one agent across ecosystems.

## Team

Solo — Januar (@januar / Tiannuryadins). The TICKR agent itself was built for the Base Stocks Maxxing Builder Quest; this entry adds the Concordium accountability layer.
