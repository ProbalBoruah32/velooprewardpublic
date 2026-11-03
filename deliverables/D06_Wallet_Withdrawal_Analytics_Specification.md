# D06 — Wallet and Withdrawal Analytics Specification

**Status:** proposed; no wallet ledger or withdrawal dataset was supplied.

## Wallet transaction model

Proposed fields: `wallet_transaction_id`, `user_id`, `occurred_at`, `transaction_type`, `amount`, `unit`, `status`, `source`, `reference_id`, and `reversal_of_transaction_id`. Product and engineering must define the sign convention, allowed types, lifecycle, unit semantics, idempotency scope, and balance reconciliation before calculation. The analytics layer should be append-oriented and preserve corrections/reversals as linked records.

## Withdrawal lifecycle

Proposed lifecycle: `requested -> under_review/processing -> completed` with terminal alternatives such as `rejected` and `reversed` only after owner approval. Proposed fields include `withdrawal_id`, `user_id`, requested amount/unit, payout-method category (never credentials), requested/processing/final timestamps, status, and non-sensitive reason category.

## Candidate KPIs

Requests, completed/pending/rejected/reversed counts, completion rate, queue age, processing duration, volume by unit, and method distribution. Every calculation requires a stable request ID, status history, timestamps, and an approved denominator. None is calculable from the supplied data; `wallet_activity` is only a simulated flag and must not be treated as a ledger.

See D11 for full metric definitions and D08 for proposed event names. No payment credentials or sensitive payout details belong in analytics reports.