// app.js — TICKR Verified demo page logic. No build step, no dependencies.
// Badge checks hit the live Concordium testnet REST API (CORS open, no auth).
// The accountability log entries are mock demo data from `node scripts/demo.js`.

const REST = "https://agent-registry-mcp.concordium.com/v1";

// Mock demo log entries — the exact records produced by the mock demo run
// (fixed reference time 2026-11-19T12:00:00Z, so they are reproducible:
// re-run the agent on the same inputs and the reason hashes match).
// Clearly labelled MOCK in the UI; they are NOT real transactions.
const MOCK_LOG_ENTRIES = [
  {
    key: "tickr.log.000001",
    record: {
      v: 1,
      d: "BUY",
      s: "B20",
      q: 21896,
      p: 45670000,
      h: "0x5338c9e520591978531e57a2d1034d913d62de1fcffc1c2d1a513b39dc51e844",
      t: "2026-11-19T12:00:00.000Z",
      b: "JyP9WvKdLrfKq3NvoaBAZ",
      j: null,
    },
    txHash: "mock-969c4e443326d74d74e406c28031ace8",
    note: "B20 BUY, score 50 — fresh NAV, deep supply, no prior snapshot.",
  },
  {
    key: "tickr.log.000002",
    record: {
      v: 1,
      d: "BUY",
      s: "B20",
      q: 21659,
      p: 46170000,
      h: "0xe8ab220d5bdeb9a917aa23e42fd58969b80a08fa722664059715dec791c28698",
      t: "2026-11-19T12:00:01.000Z",
      b: "JyP9WvKdLrfKq3NvoaBAZ",
      j: null,
    },
    txHash: "mock-4c16a9a24a2bc69c1e6f47be878b0375",
    note: "B20 BUY, score 50 — NAV flat (+1.09%) vs last snapshot.",
  },
];

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function checkRow(name, value) {
  const cls = value === true ? "check-ok" : value === false ? "check-bad" : "";
  const text = value === true ? "✓ true" : value === false ? "✗ false" : esc(String(value));
  return `<tr><th>${esc(name)}</th><td class="${cls}">${text}</td></tr>`;
}

async function verifyBadge(badge) {
  const box = $("badge-result");
  box.innerHTML = "<p>Checking against live testnet…</p>";
  try {
    const [checkRes, verifyRes] = await Promise.all([
      fetch(`${REST}/check-badge/${encodeURIComponent(badge)}?network=testnet`),
      fetch(`${REST}/verify-agent-card/${encodeURIComponent(badge)}?network=testnet`),
    ]);
    if (!checkRes.ok) throw new Error(`check-badge HTTP ${checkRes.status}`);
    if (!verifyRes.ok) throw new Error(`verify-agent-card HTTP ${verifyRes.status}`);
    const check = await checkRes.json();
    const verify = await verifyRes.json();
    const agent = (check.agents && check.agents[0]) || check;
    const valid = agent.badge_valid === true;
    const checks = agent.checks || {};
    const rows = [
      ["token id", agent.token_id ?? verify.token_id ?? "—"],
      ["owner", (agent.on_chain && agent.on_chain.owner_account) || "—"],
      ["status", (agent.on_chain && agent.on_chain.status) || "—"],
      ["agent_uri", agent.agent_uri || verify.on_chain_uri || "—"],
      ["card HTTP status", agent.http_status ?? verify.fetched?.http_status ?? "—"],
      ["on-chain hash", (agent.on_chain && agent.on_chain.metadata_hash_hex) || verify.on_chain_hash_hex || "—"],
      ["fetched card hash", verify.fetched?.sha256_hex || agent.card_sha256 || "—"],
    ]
      .map(([k, v]) => `<tr><th>${esc(k)}</th><td><code>${esc(v)}</code></td></tr>`)
      .join("");
    const checkRows = Object.entries(checks)
      .map(([k, v]) => checkRow(k, v))
      .join("");
    const issues = (agent.issues || [])
      .map(
        (i) =>
          `<li>[${esc(i.severity)}] ${esc(i.field)}: ${esc(i.message)}</li>`
      )
      .join("");
    box.innerHTML = `
      <div class="${valid ? "verdict-valid" : "verdict-invalid"}">
        ${valid ? "✓ VALID badge (live testnet)" : "✗ NOT fully valid — see issues below"}
      </div>
      <table>${rows}${checkRows}</table>
      ${issues ? `<p>Issues:</p><ul>${issues}</ul>` : ""}
      <p><a href="https://testnet.ccdscan.io/" target="_blank" rel="noopener">Open testnet explorer</a> ·
      <a href="${REST}/check-badge/${encodeURIComponent(badge)}?network=testnet" target="_blank" rel="noopener">Raw check-badge JSON</a></p>`;
  } catch (err) {
    box.innerHTML = `<div class="verdict-invalid">Could not reach the live testnet API: ${esc(err.message)}. Check your connection and try again.</div>`;
  }
}

function renderMockLog() {
  $("log-entries").innerHTML = MOCK_LOG_ENTRIES.map(
    (e) => `
    <div class="log-entry">
      <h3><code>${esc(e.key)}</code><span class="mock-tag">MOCK</span></h3>
      <p>${esc(e.note)}</p>
      <pre><code>${esc(JSON.stringify(e.record, null, 2))}</code></pre>
      <p>tx: <code>${esc(e.txHash)}</code></p>
    </div>`
  ).join("");
}

async function loadCard() {
  const hashBox = $("card-hash");
  const jsonBox = $("card-json").querySelector("code");
  try {
    const res = await fetch("agent-card.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    jsonBox.textContent = text;
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const card = JSON.parse(text);
    const tokenAddress =
      card.capabilities?.extensions?.[0]?.params?.tokenAddress ?? null;
    hashBox.innerHTML = `
      <table>
        <tr><th>SHA-256 of served bytes</th><td><code>${hex}</code></td></tr>
        <tr><th>Badge (tokenAddress)</th><td><code>${esc(tokenAddress === null ? "null — not registered yet" : tokenAddress)}</code></td></tr>
        <tr><th>Card URL</th><td><code>${esc(card.url)}</code></td></tr>
      </table>
      <p>This hash is what gets pinned on-chain as the agent's <code>metadata_hash</code>. If the served card ever changes without a re-pin, verification fails.</p>`;
  } catch (err) {
    jsonBox.textContent = `Could not load agent-card.json (${err.message}). Serve this folder with a static server, e.g.: python3 -m http.server`;
    hashBox.innerHTML = "";
  }
}

$("badge-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const badge = $("badge-input").value.trim();
  if (badge) verifyBadge(badge);
});

renderMockLog();
loadCard();
verifyBadge($("badge-input").value.trim());
