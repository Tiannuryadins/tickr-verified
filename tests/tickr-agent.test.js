// tests/tickr-agent.test.js — the vendored TICKR agent logic: scoring,
// sizing, portfolio. These rules are the agent's published, auditable
// behaviour; the Concordium layer anchors decisions made by these rules.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeToken,
  analyzeAll,
  sizeBuy,
  newPortfolio,
  applyPaperTrade,
  portfolioValue,
  erc8021Suffix,
  decodeErc8021Suffix,
  BUILDER_CODE,
  VIRTUAL_STARTING_CASH_CENTS,
} from "../src/tickr-agent.js";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

function token(overrides = {}) {
  return {
    symbol: "B20",
    name: "Backed IBIT",
    nav_price: "45.67",
    nav_price_updated_at: hoursAgo(0.5),
    total_supply: "25000",
    multiplier: 1,
    ...overrides,
  };
}

test("fresh NAV + deep supply + rising drift => BUY with score 60", () => {
  const result = analyzeToken(token(), { nav: 44.0 }, NOW);
  assert.equal(result.signal, "BUY");
  assert.equal(result.score, 60); // 30 fresh + 20 deep + 10 rising
  assert.equal(result.tradeable, true);
  assert.equal(result.reasons.length, 3);
});

test("fresh NAV + deep supply, no snapshot => BUY with score 50", () => {
  const result = analyzeToken(token(), null, NOW);
  assert.equal(result.signal, "BUY");
  assert.equal(result.score, 50);
});

test("aging NAV (1-6h) + medium supply => HOLD", () => {
  const result = analyzeToken(
    token({ nav_price_updated_at: hoursAgo(3), total_supply: "5000" }),
    null,
    NOW
  );
  assert.equal(result.signal, "HOLD");
  assert.equal(result.score, 25); // 15 aging + 10 medium
  assert.equal(result.tradeable, false);
});

test("stale NAV (>6h) => AVOID with score 0, not tradeable", () => {
  const result = analyzeToken(token({ nav_price_updated_at: hoursAgo(8) }), null, NOW);
  assert.equal(result.signal, "AVOID");
  assert.equal(result.score, 0);
  assert.equal(result.tradeable, false);
  assert.match(result.reasons[0], /stale/);
});

test("no NAV => AVOID, never priced", () => {
  const result = analyzeToken(token({ nav_price: null, nav_price_updated_at: null }), null, NOW);
  assert.equal(result.signal, "AVOID");
  assert.equal(result.nav, null);
  assert.equal(result.tradeable, false);
});

test("falling drift subtracts 10", () => {
  const result = analyzeToken(token(), { nav: 50.0 }, NOW);
  assert.equal(result.score, 40); // 30 + 20 - 10
  assert.equal(result.signal, "BUY"); // still >= 40
  assert.match(result.reasons.join(" "), /down/);
});

test("thin supply adds 0 and is explained", () => {
  const result = analyzeToken(token({ total_supply: "500" }), null, NOW);
  assert.equal(result.score, 30);
  assert.equal(result.signal, "HOLD");
  assert.match(result.reasons.join(" "), /Thin/);
});

test("analyzeAll sorts by score descending", () => {
  const results = analyzeAll(
    [token({ symbol: "LOW", total_supply: "100" }), token({ symbol: "HIGH" })],
    {},
    NOW
  );
  assert.equal(results[0].symbol, "HIGH");
  assert.equal(results[1].symbol, "LOW");
});

test("sizeBuy caps at 10% of cash in whole milli-shares", () => {
  const sized = sizeBuy(45.67, 1_000_000); // $10,000 cash -> max $1,000 spend
  assert.ok(sized.qtyMilli > 0);
  assert.ok(sized.spendCents <= 100_000);
  assert.ok(sized.spendCents > 99_000); // close to the cap
});

test("sizeBuy returns null when cash cannot buy a milli-share", () => {
  assert.equal(sizeBuy(1_000_000, 100), null);
});

test("portfolio: buy then sell updates cash and positions", () => {
  const portfolio = newPortfolio();
  assert.equal(portfolio.cashCents, VIRTUAL_STARTING_CASH_CENTS);
  const cost = applyPaperTrade(portfolio, {
    symbol: "B20",
    isBuy: true,
    qtyMilli: 1000,
    priceCents: 4567,
  });
  assert.equal(cost, 4567);
  assert.equal(portfolio.cashCents, VIRTUAL_STARTING_CASH_CENTS - 4567);
  assert.equal(portfolio.positions.B20.qtyMilli, 1000);
  applyPaperTrade(portfolio, {
    symbol: "B20",
    isBuy: false,
    qtyMilli: 1000,
    priceCents: 5000,
  });
  assert.equal(portfolio.positions.B20, undefined);
  assert.equal(portfolio.cashCents, VIRTUAL_STARTING_CASH_CENTS - 4567 + 5000);
});

test("portfolio rejects buys beyond cash and sells beyond position", () => {
  const portfolio = newPortfolio();
  assert.throws(
    () =>
      applyPaperTrade(portfolio, {
        symbol: "B20",
        isBuy: true,
        qtyMilli: 1_000_000,
        priceCents: 4567,
      }),
    /Insufficient paper cash/
  );
  assert.throws(
    () =>
      applyPaperTrade(portfolio, {
        symbol: "B20",
        isBuy: false,
        qtyMilli: 1,
        priceCents: 4567,
      }),
    /Insufficient paper position/
  );
});

test("portfolioValue computes PnL against live NAV", () => {
  const portfolio = newPortfolio();
  applyPaperTrade(portfolio, {
    symbol: "B20",
    isBuy: true,
    qtyMilli: 1000,
    priceCents: 4567,
  });
  const value = portfolioValue(portfolio, { B20: 50.0 });
  assert.equal(value.positionsValueCents, 5000);
  assert.equal(value.totalCents, VIRTUAL_STARTING_CASH_CENTS + 433);
  assert.equal(value.pnlCents, 433);
});

test("ERC-8021 builder code suffix round-trips", () => {
  const suffix = erc8021Suffix(BUILDER_CODE);
  const decoded = decodeErc8021Suffix(suffix);
  assert.equal(decoded.codes, BUILDER_CODE);
  assert.equal(decoded.schemaId, 0);
  assert.equal(decodeErc8021Suffix("0xdeadbeef"), null);
});
