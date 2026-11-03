# D04 — User Analytics Specification

**Status:** proposed analytics contract; supplied records are simulated and do not verify production implementation.

## Identity and lifecycle

Use a stable opaque `user_id` for joins. Use a unique `event_id` for event deduplication and a `session_id` for session-level grouping. A transaction ID is required for every financial/reward ledger operation. Avoid names, email addresses, or other direct identifiers in analytical events unless a documented, approved use requires them.

| Field | Type | Required | Purpose / validation | Status |
| --- | --- | --- | --- | --- |
| user_id | String | Yes for user events | Stable, non-reassigned opaque ID | Proposed; simulated field observed |
| event_id | String | Yes | Globally unique/idempotency key within documented scope | Proposed |
| occurred_at | Timestamp with timezone | Yes | Event time; reject malformed timestamps and define timezone | Proposed |
| session_id | String | Conditional | Link session-attributable interactions | Proposed; simulated field observed |
| registration_source | Category | Recommended | Approved acquisition source vocabulary | Simulated source observed; domain unverified |
| platform | Category | Recommended | Controlled platform values | Simulated field observed; domain unverified |
| account_status | Category | Yes for state snapshots | Approved lifecycle state; status-change event preferred | Simulated field observed; production states unverified |
| onboarding_status | Category | Recommended | Approved onboarding state | Simulated field observed; event history absent |
| last_activity_at | Timestamp with timezone | Derived | Latest qualifying event under approved activity rule | Proposed; do not substitute login without approval |

## Events

Proposed lifecycle: `user_registered`, `user_logged_in`, `onboarding_started`, `onboarding_completed`, and a separate account-status-change event if the system needs lifecycle history. A snapshot of current status cannot reconstruct historical transitions. Event triggers, payloads, and acceptance tests are in D08.

## Segmentation and KPIs

Potential dimensions include registration cohort, acquisition source, platform, device, and geography at an appropriately aggregated level. Candidate metrics include registrations, active users, returning users, and onboarding completion. “Active” must be defined by qualifying behavior, reporting window, timezone, and eligibility denominator before calculation.

## Privacy and limitations

Do not include full name or email in event payloads or report workbooks. Do not infer identity or demographics from simulated attributes. The supplied user sheets can support structural profiling only; production user analytics remain unverified.