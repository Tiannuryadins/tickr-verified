// payment.js — agent payment demo.
//
// The demo: an on-chain CCD transfer between two agent accounts with an
// audit-trail record linking the payment to the badge and (optionally) to a
// logged decision. Two directions are supported:
//   - "pay-for-signal": a counterparty pays the agent for a verified signal.
//   - "decision-fee":   the agent pays a small fee per verified decision
//                       (e.g. to an auditor / registry operator account).
//
// The transfer itself is a plain CCD transfer (TransferWithMemo when a memo
// is given; the memo carries the audit reference, e.g. "tickr-signal:000001").
// The audit record is the off-chain receipt; the on-chain proof is the tx
// hash + memo, resolvable on the testnet explorer.
//
// Full x402 is a STRETCH goal: x402 is live on Concordium but no step-by-step
// testnet tutorial was found during research, so this entry does NOT claim
// x402 support (agent-card.json has x402Support: false). The transfer demo
// is real; x402 would be layered on top in the path-to-production plan.

import { MICRO_CCD_PER_CCD } from "./concordium.js";

export const DEFAULT_SIGNAL_PRICE_MICRO_CCD = 1_000_000n; // 1 CCD
export const DEFAULT_DECISION_FEE_MICRO_CCD = 100_000n; // 0.1 CCD

/** Format a micro-CCD bigint as "1.5 CCD". */
export function formatCcd(microCcd) {
  const value = BigInt(microCcd);
  const whole = value / MICRO_CCD_PER_CCD;
  const frac = value % MICRO_CCD_PER_CCD;
  if (frac === 0n) return `${whole} CCD`;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${fracStr} CCD`;
}

/** Parse "1.5" / "1" (CCD) into micro-CCD. */
export function parseCcd(amountStr) {
  if (!/^\d+(\.\d{1,6})?$/.test(amountStr)) {
    throw new Error(`Invalid CCD amount "${amountStr}" (expected e.g. "1" or "0.5").`);
  }
  const [whole, frac = ""] = amountStr.split(".");
  return BigInt(whole) * MICRO_CCD_PER_CCD + BigInt(frac.padEnd(6, "0") || "0");
}

/** The on-chain memo for a payment: short, ASCII, <= 256 bytes (DataBlob limit). */
export function paymentMemo({ kind, decisionSeq = null, badge = null }) {
  const parts = [`tickr:${kind}`];
  if (decisionSeq !== null) parts.push(`seq:${String(decisionSeq).padStart(6, "0")}`);
  if (badge) parts.push(`badge:${badge}`);
  return parts.join(";");
}

/**
 * Execute a payment on the given chain and return the audit record.
 * `direction` is "pay-for-signal" (counterparty -> agent) or "decision-fee"
 * (agent -> counterparty). In mock mode the counterparty is the mock
 * counterparty account; in testnet mode it is the --to account (or the
 * agent's own wallet when paying itself is pointless — the script requires
 * an explicit --to in testnet mode).
 */
export async function executePayment(chain, {
  direction,
  from,
  to,
  amountMicroCcd,
  decisionSeq = null,
  badge = null,
}) {
  if (!["pay-for-signal", "decision-fee"].includes(direction)) {
    throw new Error(`Invalid payment direction "${direction}".`);
  }
  const memo = paymentMemo({ kind: direction, decisionSeq, badge });
  const result = await chain.transfer({
    sender: from,
    to,
    amountMicroCcd: BigInt(amountMicroCcd),
    memo,
  });
  return buildAuditRecord({
    direction,
    from,
    to,
    amountMicroCcd: BigInt(amountMicroCcd),
    memo,
    decisionSeq,
    badge,
    txHash: result.txHash,
    mode: chain.mode,
    at: result.at ?? new Date().toISOString(),
  });
}

export function buildAuditRecord({
  direction,
  from,
  to,
  amountMicroCcd,
  memo,
  decisionSeq,
  badge,
  txHash,
  mode,
  at,
}) {
  return {
    kind: "tickr-payment",
    version: 1,
    mode, // "mock" or "testnet" — mock payments are NOT real transfers
    direction,
    from,
    to,
    amountMicroCcd: BigInt(amountMicroCcd).toString(),
    amount: formatCcd(amountMicroCcd),
    memo,
    decisionSeq,
    badge,
    txHash,
    at,
    explorerUrl:
      mode === "testnet"
        ? `https://testnet.ccdscan.io/transaction/${txHash}`
        : null,
  };
}
