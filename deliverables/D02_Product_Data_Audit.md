# D02 — Product Data Readiness Audit

**Classification:** product context from the assignment brief; implementation status is not independently verified.

## Product-area map

| Area | User action to measure | System action / outcome | Data needed | Status |
| --- | --- | --- | --- | --- |
| Account | Register, log in, update permitted profile fields | Account created; status changed | Stable user ID, event ID, event time, source, status | Proposed; production instrumentation unverified |
| Onboarding | Start and complete milestones | Milestone accepted or rejected | User ID, milestone ID, timestamps, outcome | Simulated status field only; lifecycle events not supplied |
| Tasks | View, open, start, submit | Validate, complete, fail, abandon | Task/activity IDs, user ID, lifecycle times, status, reason | Simulated task activity available; validation semantics unverified |
| Earning features | Start and complete eligible action | External/provider outcome and validation | Feature, provider reference where approved, status, event ID, user ID | Proposed; external dependency must be represented |
| Rewards | Perform eligible action | Reward becomes pending, credited, reversed, or corrected | Reward transaction ID, amount, unit, source, timestamps, reversal reference | No reward ledger supplied |
| Engagement | Use features, sessions, daily activity | Record qualifying activity and milestones | User/session/event IDs, feature, event time, status | Simulated event/session/activity sheets available |
| Referrals | Create invite and invite another user | Registration, activation, conversion outcomes | Referral ID, inviter/invitee IDs, stage timestamps, status | User referral attributes only; lifecycle not supplied |
| Wallet | Review balance or redeem | Ledger credit, debit, adjustment, reversal | Transaction ID, amount, unit, type, status, source, reference | No wallet ledger supplied |
| Withdrawals | Request payout and follow status | Review, process, settle, reject, reverse | Withdrawal ID, amount, method category, timestamps, status, reason | No withdrawal records supplied |
| Support/content | Search help or request support | Ticket state or content outcome | Ticket/article IDs, category, timestamps, outcome | No support/content event data supplied |

## Event and outcome distinctions

User interaction, system processing, and business outcome must be separate facts. A task submission is not a validated completion; a completion is not proof of reward credit; a referral registration is not an activation or conversion; a withdrawal request is not a completed payout. The D08 event plan separates these states and labels implementation as proposed.

## Priority gaps

1. Production instrumentation and event ownership are unverified.
2. Stable transaction identifiers and idempotency contracts are not supplied.
3. Reward, wallet, and withdrawal ledgers are absent.
4. Referral lifecycle identifiers and conversion criteria are absent.
5. Status vocabularies, timezone conventions, and transition rules require approval.
6. Privacy retention, access, and consent rules require an accountable owner.

See [D03 Data Coverage Matrix](reports/D03_Data_Coverage_Matrix.xlsx) for field-level availability and the source register for evidence status.