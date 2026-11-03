# D15 — Developer Analytics Handoff

**Status:** proposed engineering specification; no event in this document is claimed to exist in production.

## Shared event envelope

| Property | Type | Requirement | Validation |
| --- | --- | --- | --- |
| event_id | String | Required | Stable unique idempotency key in documented scope |
| event_name | String | Required | `domain_object_action` snake_case; versioned catalogue |
| occurred_at | Timestamp with timezone | Required | Valid parse, timezone policy, and event-time semantics |
| user_id | String | Conditional by event | Stable opaque ID; no direct identifier |
| session_id | String | Conditional | Present for session-attributable events |
| feature | String/category | Conditional | Approved product feature identifier |
| status | String/category | Conditional | Approved, versioned vocabulary |
| source | String/category | Required | Distinguish frontend, backend, and approved provider source |
| schema_version | String/integer | Required for evolution | Versioned contract; backward-compatibility policy |

## Implementation rules

- Separate user interaction, system processing, and business outcome events.
- A task completion event is emitted only after applicable validation; reward credit is a separate ledger-confirmed event.
- A referral registration is not activation or conversion.
- Financial/reward events require transaction IDs, units, statuses, and linked reversal/correction IDs as applicable.
- Use idempotent ingestion keyed by event ID. Define duplicate behavior, retry behavior, and late-arrival handling.
- Do not put names, emails, credentials, payout details, or sensitive provider payloads in analytics events.
- Invalid payloads should be rejected or quarantined with safe diagnostics; raw values must not be written to logs.

## Acceptance-test pattern

For every D08 event, engineering should test: valid payload accepted once; duplicate event ID is idempotent; required missing field rejected; malformed timestamp rejected/quarantined; unknown status handled per versioned rule; and source/business outcomes remain distinct. Event-specific triggers and KPI dependencies are in `D08_Event_Tracking_Plan.xlsx`.

## Proposed owner and approval

Product approves event meaning and state transitions. Engineering owns emission, identifiers, idempotency, and schema evolution. Analytics owns validation of downstream usability. Named owners and deployment status remain to be verified.