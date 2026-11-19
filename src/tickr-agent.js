// TICKR Agent — VENDORED COPY.
// Origin: ~/workspace/base-stocks-maxxing/app/agent.js (the TICKR entry for
// the Base Stocks Maxxing Builder Quest). This file is the SAME code,
// vendored here so the published TICKR Verified repo is self-contained.
// Upstream changes must be copied over deliberately; do not edit the rules
// here without updating the Base entry too.
//
// TICKR Agent — shared agent logic (no dependencies, works in Node and browser).
// Data source: Coinbase Tokenized Stocks API (public, read-only, no API key).
//   https://api.coinbase.com/v1/tokenized-stocks
// The agent is a transparent RULE-BASED engine. Every signal it produces carries
// the exact rule that fired, so anyone can audit the decision. It is NOT a
// black-box model, and it never claims predictive power it does not have.

export const TOKENIZED_STOCKS_API = "https://api.coinbase.com/v1/tokenized-stocks";
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_SEPOLIA_RPC = "https://sepolia.base.org";
export const BASE_SEPOLIA_EXPLORER = "https://sepolia.basescan.org";
export const BUILDER_CODE = "bc_sijyqbvn"; // registered for the TICKR agent wallet
export const VIRTUAL_STARTING_CASH_CENTS = 1_000_000; // $10,000.00 paper cash

// ---- ERC-8021 Builder Code suffix -------------------------------------------
// Layout (per Base docs): ascii(codes) + 1-byte length + 1-byte schema id (0x00)
// + 16-byte marker 0x8021 repeated 8 times. Contracts ignore the suffix;
// offchain indexers extract it for attribution.
export const ERC8021_MARKER = "80218021802180218021802180218021";

export function erc8021Suffix(builderCode) {
  const ascii = Array.from(new TextEncoder().encode(builderCode))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const len = builderCode.length.toString(16).padStart(2, "0");
  return "0x" + ascii + len + "00" + ERC8021_MARKER;
}

export function decodeErc8021Suffix(dataHex) {
  const hex = dataHex.startsWith("0x") ? dataHex.slice(2) : dataHex;
  if (!hex.endsWith(ERC8021_MARKER)) return null;
  const body = hex.slice(0, -ERC8021_MARKER.length);
  const schemaId = body.slice(-2);
  const len = parseInt(body.slice(-4, -2), 16);
  const asciiHex = body.slice(-4 - len * 2, -4);
  const codes = new TextDecoder().decode(
    new Uint8Array(asciiHex.match(/.{2}/g).map((h) => parseInt(h, 16)))
  );
  return { codes, schemaId: parseInt(schemaId, 16), length: len };
}

// ---- API --------------------------------------------------------------------

export async function fetchAllTokens(fetchFn = fetch) {
  const tokens = [];
  let pageToken = null;
  for (let page = 0; page < 10; page++) {
    const url =
      TOKENIZED_STOCKS_API +
      "?page_size=500" +
      (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : "");
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`Tokenized Stocks API HTTP ${res.status}`);
    const data = await res.json();
    tokens.push(...(data.tokens || []));
    pageToken = data.next_page_token;
    if (!pageToken) break;
  }
  return tokens;
}

// ---- Research engine (transparent rules) ------------------------------------
// A token is TRADEABLE only when it has a live NAV price + timestamp.
// Scoring is additive and every point is explained in `reasons`.
//   freshness: NAV age < 1h => +30 ("fresh"), 1-6h => +15 ("aging"),
//              > 6h => signal forced to AVOID ("stale NAV").
//   supply:    total_supply > 10000 => +20 ("deep"), 1000-10000 => +10,
//              < 1000 or missing => +0 ("thin/unknown").
//   drift:     vs previous snapshot (if any): NAV up > 2% => +10 ("rising"),
//              NAV down > 2% => -10 ("falling"), else +0 ("flat").
// Signal: score >= 40 => BUY, 20-39 => HOLD, < 20 or stale => AVOID.
// Sizing: at most 10% of available paper cash per BUY, whole milli-shares.

export function analyzeToken(token, prevSnapshot, nowMs = Date.now()) {
  const reasons = [];
  let score = 0;
  const nav = token.nav_price != null ? Number(token.nav_price) : null;
  const updatedAt = token.nav_price_updated_at
    ? Date.parse(token.nav_price_updated_at)
    : null;

  if (nav == null || !updatedAt || Number.isNaN(updatedAt)) {
    return {
      symbol: token.symbol,
      name: token.name,
      nav: null,
      signal: "AVOID",
      score: 0,
      reasons: ["No live NAV price published for this token — cannot price a trade."],
      tradeable: false,
    };
  }

  const ageHours = (nowMs - updatedAt) / 3_600_000;
  if (ageHours < 1) {
    score += 30;
    reasons.push(`NAV fresh (${ageHours.toFixed(1)}h old).`);
  } else if (ageHours <= 6) {
    score += 15;
    reasons.push(`NAV aging (${ageHours.toFixed(1)}h old).`);
  } else {
    return {
      symbol: token.symbol,
      name: token.name,
      nav,
      navAgeHours: ageHours,
      signal: "AVOID",
      score: 0,
      reasons: [`NAV stale (${ageHours.toFixed(1)}h old) — price not reliable.`],
      tradeable: false,
    };
  }

  const supply = token.total_supply != null ? Number(token.total_supply) : null;
  if (supply != null && supply > 10000) {
    score += 20;
    reasons.push(`Deep supply (${supply.toLocaleString()} tokens minted).`);
  } else if (supply != null && supply >= 1000) {
    score += 10;
    reasons.push(`Medium supply (${supply.toLocaleString()} tokens minted).`);
  } else {
    reasons.push("Thin or unknown supply — low onchain depth.");
  }

  let driftPct = null;
  if (prevSnapshot && prevSnapshot.nav) {
    driftPct = ((nav - prevSnapshot.nav) / prevSnapshot.nav) * 100;
    if (driftPct > 2) {
      score += 10;
      reasons.push(`NAV up ${driftPct.toFixed(2)}% vs last snapshot.`);
    } else if (driftPct < -2) {
      score -= 10;
      reasons.push(`NAV down ${driftPct.toFixed(2)}% vs last snapshot.`);
    } else {
      reasons.push(`NAV flat (${driftPct.toFixed(2)}% vs last snapshot).`);
    }
  } else {
    reasons.push("No prior snapshot — this run records the baseline.");
  }

  const signal = score >= 40 ? "BUY" : score >= 20 ? "HOLD" : "AVOID";
  return {
    symbol: token.symbol,
    name: token.name,
    nav,
    navAgeHours: ageHours,
    supply,
    multiplier: token.multiplier,
    driftPct,
    signal,
    score,
    reasons,
    tradeable: signal === "BUY",
  };
}

export function analyzeAll(tokens, snapshots = {}, nowMs = Date.now()) {
  return tokens
    .map((t) => analyzeToken(t, snapshots[t.symbol], nowMs))
    .sort((a, b) => b.score - a.score);
}

// Size a BUY: at most 10% of available cash, in whole milli-shares.
export function sizeBuy(navUsd, availableCashCents) {
  const maxSpendCents = Math.floor(availableCashCents * 0.1);
  const qtyMilli = Math.floor((maxSpendCents / 100 / navUsd) * 1000);
  if (qtyMilli <= 0) return null;
  const spendCents = Math.round((qtyMilli / 1000) * navUsd * 100);
  return { qtyMilli, spendCents };
}

// ---- Paper portfolio (pure functions; storage is the caller's job) -----------

export function newPortfolio() {
  return {
    cashCents: VIRTUAL_STARTING_CASH_CENTS,
    positions: {}, // symbol -> { qtyMilli, avgCostCents }
    trades: [], // local mirror of onchain journal entries
    snapshots: {}, // symbol -> { nav, at }
    createdAt: new Date().toISOString(),
  };
}

export function applyPaperTrade(portfolio, { symbol, isBuy, qtyMilli, priceCents }) {
  const costCents = Math.round((qtyMilli / 1000) * priceCents);
  if (isBuy) {
    if (costCents > portfolio.cashCents) throw new Error("Insufficient paper cash.");
    const pos = portfolio.positions[symbol] || { qtyMilli: 0, avgCostCents: 0 };
    const totalQty = pos.qtyMilli + qtyMilli;
    pos.avgCostCents = Math.round(
      (pos.avgCostCents * pos.qtyMilli + priceCents * qtyMilli) / totalQty
    );
    pos.qtyMilli = totalQty;
    portfolio.positions[symbol] = pos;
    portfolio.cashCents -= costCents;
  } else {
    const pos = portfolio.positions[symbol];
    if (!pos || pos.qtyMilli < qtyMilli) throw new Error("Insufficient paper position.");
    pos.qtyMilli -= qtyMilli;
    if (pos.qtyMilli === 0) delete portfolio.positions[symbol];
    portfolio.cashCents += costCents;
  }
  return costCents;
}

export function portfolioValue(portfolio, liveNavBySymbol) {
  let positionsValueCents = 0;
  for (const [symbol, pos] of Object.entries(portfolio.positions)) {
    const nav = liveNavBySymbol[symbol];
    if (nav != null) positionsValueCents += Math.round((pos.qtyMilli / 1000) * nav * 100);
  }
  const total = portfolio.cashCents + positionsValueCents;
  return {
    cashCents: portfolio.cashCents,
    positionsValueCents,
    totalCents: total,
    pnlCents: total - VIRTUAL_STARTING_CASH_CENTS,
    pnlPct: ((total - VIRTUAL_STARTING_CASH_CENTS) / VIRTUAL_STARTING_CASH_CENTS) * 100,
  };
}
