# CHECKPOINT 1 DRAFT — for the Encode platform (due Sun 22 Nov 2026 23:59 UTC)

Paste-ready idea write-up for the Concordium × Encode Club Trusted Agents Hackathon, Checkpoint 1 ("create your project, add your team and share your idea"). No demo/code/video is needed for this checkpoint — just the idea. The platform action itself is user-only (needs an Encode Club account).

---

## Project name

**TICKR Verified**

## One-paragraph idea

TICKR is a transparent rule-based agent that paper-trades Coinbase tokenized stocks and logs every decision — plus a keccak256 hash of its reasoning — to a public journal on Base Sepolia. But that journal is unauthenticated: anyone can log entries, and nothing proves *which* agent made a decision or that a verified human stands behind it. TICKR Verified closes that gap with Concordium: the agent is registered in the CIS-8004 Agent Registry with a Verified by Concordium badge, its Base key is bound via CIS-8, and every decision is anchored in an on-chain accountability log on Concordium testnet — so anyone can verify decision → reason hash → log entry → badge → Agent Card, with no key and no trust in the agent operator.

## Which Concordium components

- **CIS-8004 Agent Registry** — agent registration, the Verified by Concordium badge (the agent NFT's token address), Agent Card pinning via `setAgentURI`, and the accountability log via `setMetadata`.
- **CIS-8 External Key Registry** — binds the agent's existing Base Sepolia key to its Concordium account with an ethereum-personal-sign proof, attached as the agent's `external_reference`.
- **Agent Registry MCP service** — payload building and keyless reads/verification (badge checks, `agent_of`, `get_metadata`).
- **Concordium ID** — the owner account is backed by an Identity Provider identity, so a verified human stands behind the agent.
- **CCD payments** — on-chain testnet transfers with memos linking payments to verified signals/decisions. (x402 as a stretch goal.)

## Plan / milestones

1. **Done (19 Nov):** full local build — vendored TICKR agent, mock + testnet chain layer, Agent Card, accountability log schema, payment demo, badge verification, demo page; 83/83 tests pass, including live testnet reads and payload building.
2. **By 23 Nov:** testnet account setup (Browser Wallet + faucet) → register the agent on testnet, mint the badge, host + pin the Agent Card.
3. **By 30 Nov:** CIS-8 binding live; accountability log running on real decisions; payment demo on testnet; demo video recorded.
4. **By 9 Dec:** final submission — public repo, demo video (≤3 min), CCDExplorer links, path-to-production plan.

## Team

Solo — Januar (@januar / Tiannuryadins). The TICKR agent was built for the Base Stocks Maxxing Builder Quest; this entry adds the Concordium accountability layer.

---

## Notes for the user (not part of the paste)

- Create the Encode Club account + apply on the programme page first (free), then create the project and paste the above. Do it before 22 Nov 23:59 UTC — it is unknown whether Checkpoint 1 is a hard gate, so treat it as one.
- The exact form fields are behind the Encode login; if the form asks for something not covered above (e.g. a repo link), the repo is not public yet — write "repo to be published after testnet registration" or similar, honestly.
- Indonesia eligibility: no exclusion was found anywhere, but Indonesia is not explicitly named — confirm nothing blocks Indonesian participants when creating the account.
