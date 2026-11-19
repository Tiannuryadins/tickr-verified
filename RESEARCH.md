# Concordium × Encode Club — Trusted Agents Hackathon: Research Report

**Checked:** 19 November 2026, ~12:15 UTC (19:15 WIB). All facts below were re-verified live on this date unless marked otherwise.
**Scope:** research only. No accounts created, nothing submitted, nothing built.

---

## 1. Hackathon facts (verified)

| Fact | Value | Source |
|---|---|---|
| Programme | Concordium Trusted Agents Hackathon, run with Encode Club. Free six-week online programme: 3 weeks workshops (2–18 Nov) + 3 weeks building on testnet (19 Nov–9 Dec) | https://www.encodeclub.com/programmes/concordium-trusted-agents-hackathon |
| Prize pool | **3M CCD total: 1M CCD each for 1st, 2nd, 3rd place.** Winners also remain eligible for Concordium's 75M CCD Grants Program | Encode programme page, "Prizes" + "The Brief" sections |
| CCD price (19 Nov 2026) | ~$0.0029–0.0030/CCD (CoinLore $0.00291, 18 Nov; CryptoDaily $0.00306, 19 Nov). So **1M CCD ≈ $2,900–3,000; 3M CCD ≈ $8,700–9,000** | https://www.coinlore.com/convert/ccd-concordium/usd ; https://cryptodaily.co.uk/index/concordium |
| Final deadline | **Wednesday 9 December 2026, 23:59 UTC** (= Thursday 10 Dec 2026, 06:59 WIB). Platform locks at the deadline; submit early | Encode programme page, "Key dates" + Concordium article |
| Judging | 10–11 December 2026, by Encode and Concordium | Encode programme page |
| Build window | Opened Thursday 19 November 2026 | Encode programme page |
| Cost | Free. "Entry is free, everything happens online", test CCD free from the faucet | https://www.concordium.com/article/concordium-trusted-agents-hackathon-encode-club |
| What to build | Take an EXISTING AI agent (Ethereum, Solana, or 200+ supported chains) and add: Verified by Concordium badge (verified human behind it), Agent Registry entry + ERC-8004 Agent Card, x402 agent payments. Must run on Concordium testnet and make meaningful use of at least one Concordium component (Concordium ID / Verify and Access, Agent Registry + badge, x402, Protocol-Level Tokens, sponsored transactions, or the Agent Registry MCP server) | Encode programme page, "Requirements" |
| Solo or team | Solo allowed ("you can build solo or in a team"). Encode's general rules cap teams at 6 | Concordium article "Who Should Join"; https://encodeclub.notion.site/Hackathon-Rules-1206c123e77d818290cfe62949c71593 |

### Submission requirements (final, 9 Dec)
From the Encode programme page ("What to submit") and the Concordium article:
1. Description of what was built, how it works, which Concordium components it uses
2. A **public code repository**
3. A **demo video of up to 3 minutes**
4. A **CCDExplorer link** showing the agent, contract or transactions (testnet explorer is https://testnet.ccdscan.io — see §3)
5. A **path to production**: what it would take to go live on mainnet, in front of real users

Submitted "from your project page" on the Encode platform.

### Judging criteria
Depth of integration (identity, Agent Registry, agent payments); credible path to production; end-to-end working demo; usefulness / real problem. Transaction counts do NOT matter (test tokens are free).

### Eligibility — Indonesia
- **No country exclusion found anywhere.** The programme page says "Open to AI developers from any ecosystem, no blockchain experience needed"; the Concordium article says "This year the programme is online, so builders anywhere can join." Encode's general hackathon rules list no nationality restriction, and a past Encode hackathon listing stated "Nationality: No specific nationality required / Anyone can take part."
- **Caveat:** Indonesia is not *explicitly* named as eligible, and the full programme T&Cs (if any exist behind the Encode account wall) were not readable without an account. Indonesia is not a sanctioned jurisdiction, so eligibility is very likely but **not 100% confirmed**. Flag: the user should confirm nothing blocks Indonesian participants when creating the Encode account (e.g. prize payout/KYC terms at win time).

---

## 2. Checkpoint 1 — 22 November 2026 (detail)

**Deadline: Sunday 22 November 2026, 23:59 UTC** (= Monday 23 Nov 2026, 06:59 WIB).

**What it requires (verbatim from the Encode programme page): "Checkpoint 1 (create your project, add your team and share your idea)".**
That is: on the Encode Club platform, create the project entry, add team members (solo = just yourself), and write up the project idea. No demo, no code, no video, no live call is mentioned for this checkpoint. Office hours (Tue/Fri 15:00 UTC, from 24 Nov) are optional support, not a checkpoint requirement.

**Agent-doable vs user-only — judgment:**
- **The idea write-up itself is agent-doable** (we can draft the project name, description, chosen Concordium components, and plan).
- **The platform action is USER-ONLY.** Participation requires an Encode Club account ("To take part, create an Encode Club account and apply on the programme page" — Concordium article). Creating the account and creating the project on the Encode platform is a logged-in web action that needs the user's account/credentials. An agent cannot do this without the user creating the account first (and per our rules, agents do not create accounts for the user).
- **Practical plan:** user creates the Encode Club account + applies (free, a few minutes), then either (a) the user pastes our drafted idea into the project form themselves, or (b) a browser agent does the form-filling in a logged-in session the user opens. Do this **before 22 Nov 23:59 UTC** — do not leave it to the last evening, because it is unknown whether Checkpoint 1 is a hard gate for final submission (see "Could not verify" below).

---

## 3. Concordium testnet tooling (verified)

### 3.1 Public testnet node endpoint (script-callable)
- **gRPC v2 / gRPC-web: `grpc.testnet.concordium.com:20000`, TLS enabled** (`https://grpc.testnet.concordium.com:20000`). Chain methods only; maintained by Concordium, availability not guaranteed. Status: https://status.testnet.concordium.software
- **Live check 19 Nov 12:16 UTC:** the Agent Registry MCP `network_status` tool reported testnet at block **51,016,022** via this endpoint — the endpoint is up and current.
- There is **no public JSON-RPC endpoint** for Concordium (it is not an EVM chain). Access is via gRPC v2, gRPC-web, the SDKs, or the hosted MCP/REST services below.
- Sources: https://docs.concordium.com/en/mainnet/tutorials/setup-env.html ; https://docs.concordium.com/en/mainnet/docs/resources/exchangeOnBoarding.html

### 3.2 Testnet faucet (free test CCD)
- **Direct HTTP (scriptable, no account/captcha documented):**
  `curl -X PUT https://wallet-proxy.testnet.concordium.com/v0/testnetGTUDrop/YOUR_ACCOUNT_ADDRESS`
  (documented in the official exchange-onboarding guide; NOT live-tested in this research — needs an account address first).
- **Via Browser Wallet:** open testnet account → Activity → "Request CCD". Amount: the setup guide says **2,000 CCD**; the PLT tutorial says **20,000 CCD** (docs disagree — flag for the builder; either way it is far more than enough for hackathon tx fees). **Each account can request only once**, and only for an account with no prior incoming transactions.
- Sources: https://docs.concordium.com/en/mainnet/docs/resources/exchangeOnBoarding.html ; https://docs.concordium.com/en/mainnet/tutorials/plt/request-ccd.html ; https://docs.concordium.com/en/mainnet/tutorials/setup-env.html

### 3.3 ID layer — how identity works for an agent
- Every Concordium account is backed by an identity issued by an Identity Provider (IDP). On **mainnet** this is a real KYC check (passport/liveness in the wallet). On **testnet, identities are issued WITHOUT verification**: in the Browser Wallet you select "Concordium testnet IP" and no ID document is needed. Test identities are testnet-only.
- The "verified human" story for the hackathon: the human verifies once with an IDP; the agent then carries the Verified by Concordium badge, which proves *an accountable person stands behind it* without revealing who. Attribute proofs (e.g. age) use zero-knowledge proofs — personal data stays off-chain.
- **Builder implication:** on testnet, no real KYC is needed at all. But creating the identity + account in the documented flow goes through the **Browser Wallet (Chrome extension)** — a human/browser step. The wallet can then export the account key (`.export` file with signKey) for use with `concordium-client` or the Node SDK. A fully programmatic (no-browser) identity/account creation path is NOT documented in the standard guides — treat wallet setup as a likely user step, or a builder spike (wallet-proxy APIs exist but are not documented as a public account-creation flow).
- Sources: https://docs.concordium.com/en/mainnet/tutorials/setup-env.html ("Set up a wallet"); https://docs.concordium.com/en/mainnet/docs/resources/exchangeOnBoarding.html ("Testnet works like mainnet, but identities are issued without verification"); https://www.concordium.com/build/ai-agent-technology

### 3.4 Agent Registry — what it is and how to register
- Two on-chain standards:
  - **CIS-8004** — the Agent Registry. Each registered agent is minted as a non-fungible CIS-2 token (NFT). The token stores a pointer (`agent_uri`) to an off-chain Agent Card (ERC-8004/A2A format) whose integrity is protected by an on-chain SHA-256 `metadata_hash`, plus a key-value metadata store (reserved key `agentWallet` = payment wallet). Status Active/Revoked. Entrypoints: `register`, `revoke`, `setAgentURI`, `setMetadata`, `setAgentWallet`, `transfer`, `updateOperator`.
  - **CIS-8** — External Key Registry. Records a cryptographically-proven binding between a Concordium account and an external public key (Ethereum, Solana, etc.). Attachable to a CIS-8004 agent as `external_reference`, so an agent that lives on another chain keeps its own chain while anchored to Concordium identity.
- **Contract addresses (VERIFIED LIVE via the MCP `contract_info` tool, 19 Nov 12:16 UTC):**
  - **Testnet: CIS-8004 `<12802, 0>`** (module `0e57473715d1c2a364fa626b8783688db32b7fac9d0e2fc97043da91e1a7d3eb`); **CIS-8 `<12801, 0>`** (module `3236c12fade1b559935906df2e0e43a372234eac5d40599d6e6cb12cdd6b9afd`). Explorer base: https://testnet.ccdscan.io
  - Mainnet (docs): CIS-8004 `<10082, 0>`, CIS-8 `<10081, 0>`.
- **Verified by Concordium badge:** the badge string IS the agent's CIS-8004 NFT token address (Base58Check short form, e.g. `Mf22soLh1NuZYFgBK8iSs`, or CAIP-19 canonical form). Anyone can resolve it on-chain: `agent_of(token_id)` → owner, status, `agent_uri`, `metadata_hash`; then fetch the card and check SHA-256. The badge is embedded in the Agent Card as an A2A extension (`https://docs.concordium.com/a2a-extensions/concordium-badge/v1`).
- **Registration is free on mainnet** (sponsored transactions — Concordium pays the fee); on testnet fees are paid in free test CCD anyway.
- Sources: https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/index.html ; https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/cis-8004.html ; https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/concordium-badge.html ; live MCP query (see §3.5).

### 3.5 Agent Registry MCP server + REST API (the easiest integration surface)
- **Hosted MCP (no auth, mainnet + testnet + devnet configured): `https://agent-registry-mcp.concordium.com/mcp`** (JSON-RPC 2.0, MCP streamable HTTP). Health: `https://agent-registry-mcp.concordium.com/healthz` (returned `{"ok":true,"version":"0.1.0"}` on 19 Nov). OpenAPI: `/openapi.json`, Swagger UI: `/docs`.
- **40 tools**, including: `build_register`, `build_set_agent_uri`, `build_set_metadata`, `build_set_agent_wallet`, `build_cis8_register`, `build_agent_card`, `build_agent_badge`, `get_badge_json`, `check_badge`, `verify_agent_card`, `agent_of`, `agents_by_owner`, `contract_info`, `network_status`, `list_agents`, `search_agents`. Transaction-builder tools return sign-ready `{hex, schema_json}` payloads — **the service holds no private keys**; the caller signs with their own wallet/SDK and submits.
- **REST twins (plain GET, no auth, CORS open, rate-limited per IP):** `GET /v1/get-badge-JSON/{badge}`, `GET /v1/check-badge/{badge|account}` (alias `/v1/badge-check/...`), `GET /v1/verify-agent-card/{badge}`, `GET /v1/build-set-agent-uri/{badge}?metadata_hash_hex=&agent_uri=&sender=`. Network is resolved from the badge; `?network=testnet` overrides.
- **Indexer (discovery/search REST API):** https://agent-registry-indexer.concordium.com/ (its `/` lists routes).
- **Live-verified 19 Nov 12:16 UTC:** MCP `initialize` handshake + `contract_info` (testnet) + `network_status` (testnet) all returned valid JSON over HTTPS from this VM.
- Source: https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/mcp-service.html

### 3.6 Agent payments — x402 + sponsored transactions
- Concordium is a supported network in the open **x402** standard (agent HTTP payments). x402 payments settle on Concordium; **sponsored transactions** (Protocol 10, live since March 2026) let the fee payer differ from the sender, so an agent can pay in a stablecoin/PLT while a facilitator pays the ~€0.01 CCD fee — end users never hold tokens. Agent Registry registration itself is free via sponsored transactions.
- **Caveat for the builder:** the x402-on-Concordium facilitator setup is the least-documented piece in this research. The docs confirm x402 is live and the hackathon lists it as a component, but a step-by-step "x402 on testnet" tutorial was not located (workshop 3, 9 Nov, "Let your agent pay and get paid" presumably covers it — recordings may be on Encode/YouTube). A pragmatic fallback that still satisfies "meaningful use of a Concordium component": CIS-8004 registration + badge + CIS-8 binding + an on-chain CCD payment/transfer between agents (plain transfer via the SDK), rather than full x402. Treat full x402 as a stretch goal, not the core.
- Sources: https://www.concordium.com/article/sponsored-transactions-who-pays-the-fee ; https://medium.com/@concordium/agent-registry-update-six-platforms-xdc-ai-x402-live-633bd4721a96 ; https://www.concordium.com/build/ai-agent-technology

### 3.7 SDKs
- **Node.js/TypeScript (recommended): `@concordium/web-sdk`** — works in both web and Node.js environments. Repo: https://github.com/Concordium/concordium-node-sdk-js (Apache-2.0; packages: `@concordium/web-sdk`, `@concordium/rust-bindings` via WASM, `@concordium/ccd-js-gen` for generating typed contract clients, `@concordium/wallet-connectors`). The Encode starter pack calls it "the JavaScript and TypeScript SDK most teams will use". Install via npm/yarn; no Rust toolchain needed just to *use* the SDK (only to build it from source).
- **Rust SDK** exists (`concordium-rust-sdk`) and smart contracts are written in Rust (`cargo-concordium` + `wasm32v1-none` target) — only needed if the entry deploys its own contract. **Not needed** for a registry/badge/x402 entry: the registry contracts are already deployed; the entry just calls them.
- **Python:** no official Concordium Python SDK was found. Python builders should either use Node.js for the chain layer, or drive the chain through the MCP server's REST endpoints (GET-only, read/verify + payload building) plus a small Node helper for signing/submitting.
- **concordium-client** CLI (Linux binary) is the documented tool for deploying/interacting with contracts from a terminal; it can import a wallet-exported key.
- Sources: https://github.com/Concordium/concordium-node-sdk-js ; https://docs.concordium.com/en/mainnet/tutorials/setup-env.html ; Encode programme page starter pack.

### 3.8 Other useful links
- Developer hub: https://www.concordium.com/build (entry point to SDKs/tools/guides)
- dApp examples repo: linked from the Encode starter pack (GitHub Concordium examples)
- CCDExplorer (mainnet): https://ccdexplorer.io ; **testnet explorer: https://testnet.ccdscan.io**
- Agent Registry app (web UI): https://agent-registry.concordium.com
- Workshop recordings: Encode Club YouTube (e.g. Workshop 1 "Verify Once. Prove Everywhere. Reveal Nothing", https://www.youtube.com/watch?v=EOIIaOKOKF4)

---

## 4. Could NOT verify (plainly stated)

1. **Whether Checkpoint 1 (22 Nov) is a hard gate** for final submission (i.e. whether missing it disqualifies the entry, or it is just a progress nudge). Neither the Encode page nor the Concordium article says. Treat it as a hard deadline to be safe.
2. **The exact Checkpoint 1 form fields** (what "share your idea" asks for — length limits, required fields). These live behind the Encode account/project flow, which requires login. Not accessible without an account.
3. **Indonesia explicitly named as eligible** (see §1 caveat). No exclusion found; not explicitly confirmed.
4. **The faucet HTTP endpoint live behaviour** (`PUT .../testnetGTUDrop/...`) — documented in official docs but not live-tested (needs a testnet account address, which requires wallet setup).
5. **Testnet x402 facilitator details** — no step-by-step testnet x402 tutorial was located in the docs (see §3.6 caveat).
6. **Faucet amount** — docs disagree (2,000 vs 20,000 CCD). Immaterial to the build.
7. **Testnet genesis hash / CAIP-2 chain id for testnet** (needed for canonical CAIP-19 badge strings on testnet). Obtainable at build time via the SDK/MCP; not recorded here.
8. **Prize payout mechanics** (how/when CCD is paid to winners, KYC for payout, token lockups). Not stated on the public pages.

---

## 5. Recommended integration approach for the builder

**Core (must-have, all verified + agent-doable once a testnet account exists):**
1. **Testnet account + funding** — Browser Wallet (user step, ~10 min, no ID needed on testnet) → export key → fund via faucet (wallet button or the scriptable `PUT` endpoint). Keep the exported key in a mode-600 file; never commit it.
2. **Register the agent in CIS-8004 on testnet (`<12802, 0>`)** — use the hosted MCP `build_register` tool (or its REST/Node-SDK equivalent) to build the payload, sign with `@concordium/web-sdk` + the exported key, submit to `grpc.testnet.concordium.com:20000`. Host an ERC-8004/A2A Agent Card (e.g. on GitHub Pages) and pin its SHA-256 via `setAgentURI`. This yields the **Verified by Concordium badge** string — the centrepiece of the entry.
3. **Bind the agent's existing chain key via CIS-8 (`<12801, 0>`)** — e.g. bind the user's EVM address (OKX wallet) as `external_reference`. This demonstrates the cross-chain story and is explicitly one of the suggested directions ("agents check each other's badge").
4. **Badge verification demo** — a small page/script that resolves a badge via the MCP REST endpoint (`GET /v1/check-badge/{badge}?network=testnet`) and/or directly on-chain (`agent_of` + card hash check), showing owner + Active status + card integrity. This is the "accountability" demo and is fully scriptable with plain HTTPS (no wallet needed for reads).
5. **Agent payment demo** — at minimum, an on-chain testnet CCD transfer between two agent accounts with an audit-trail record (who paid whom, for what, linked to the badge). Full x402 as a stretch goal if the facilitator path becomes clear; do not let x402 block the core.

**SDK choice:** Node.js + `@concordium/web-sdk` (npm) for signing/submitting; plain `fetch`/`curl` against the MCP REST endpoints for reads and payload-building. No Rust, no own smart contract needed. No Python SDK exists — keep the chain layer in Node.js even if the agent itself is Python.

**Testnet touchpoints (all free, no accounts):**
- gRPC node: `https://grpc.testnet.concordium.com:20000`
- Faucet: `PUT https://wallet-proxy.testnet.concordium.com/v0/testnetGTUDrop/<address>`
- MCP: `https://agent-registry-mcp.concordium.com/mcp` (+ REST `/v1/...`, no auth)
- Registry contracts (testnet): CIS-8004 `<12802,0>`, CIS-8 `<12801,0>`
- Explorer: https://testnet.ccdscan.io (for the submission's CCDExplorer link)

**Human-only steps (cannot be agent-done):** (1) Encode Club account + Checkpoint 1 project creation (by 22 Nov 23:59 UTC); (2) Browser Wallet install + testnet identity/account creation + key export (one-time, ~10 min); (3) demo video ≤3 min + final submission from the project page (by 9 Dec 23:59 UTC). Everything else — code, registration transactions, card hosting, verification demo — is agent-doable once the key is available.

---

## 6. Top 3 testnet doc URLs (for the builder)

1. **Agent Registry technical reference (index):** https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/index.html
2. **MCP service (tools, REST, testnet config):** https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/mcp-service.html
3. **Dev environment setup (testnet node, wallet, faucet, key export):** https://docs.concordium.com/en/mainnet/tutorials/setup-env.html

(Also essential: badge spec https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/concordium-badge.html ; CIS-8004 https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/cis-8004.html ; Node SDK https://github.com/Concordium/concordium-node-sdk-js ; faucet/HTTP endpoint https://docs.concordium.com/en/mainnet/docs/resources/exchangeOnBoarding.html)
