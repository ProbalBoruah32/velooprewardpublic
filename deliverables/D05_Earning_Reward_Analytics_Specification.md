# D05 — Earning and Reward Analytics Specification

**Status:** proposed. Supplied task/event activity is simulated; no standalone reward ledger is present.

## Required lifecycle

`discovery -> start -> submission/completion -> validation -> pending reward -> credited -> reversed/corrected when applicable`

Each stage is a separate event/state. User activity must not be reported as reward credit. A credit is confirmed only by the reward ledger or authoritative system outcome.

## Proposed task activity record

| Field | Requirement |
| --- | --- |
| activity_id | Stable unique ID for an attempt; supports deduplication |
| user_id | Opaque user key |
| task_id / task_type | Approved task definition and category |
| feature | Earning feature/source, including provider category when relevant |
| started_at / submitted_at / validated_at | Event timestamps with timezone |
| task_status | Approved lifecycle state, versioned |
| failure_reason_category | Non-sensitive, approved reason; never invent internal codes |
| validation_status | Explicit result and validator/system source |
| reward_transaction_id | Link to reward ledger only when a transaction exists |

## Reward ledger fields

Proposed: `reward_transaction_id`, `user_id`, source activity/reference, amount, unit, status, created/credited timestamps, and `reversal_of_transaction_id`. Units such as XP, Gems, Tokens, or VEs must be confirmed. Pending, credited, reversed, and corrected are distinct outcomes. Corrections should reference the original transaction instead of overwriting history.

## Metrics and limitations

Candidate measures include task starts, validated completion rate, failure/abandonment rate, pending rewards, confirmed credits, reversals, and credited quantity by source and unit. Reward KPIs are blocked because no reward transaction sheet or approved lifecycle definition was supplied. Simulated flags such as `reward_related_flag` are not ledger evidence.