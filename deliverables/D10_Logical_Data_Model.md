# D10 — Logical Data Model

**Status:** proposed logical model based on the assignment and simulated sheet structure; engineering must confirm keys and cardinalities.

```mermaid
erDiagram
    USERS ||--o{ SESSIONS : has
    USERS ||--o{ FEATURE_EVENTS : performs
    SESSIONS ||--o{ FEATURE_EVENTS : groups
    USERS ||--o{ DAILY_ACTIVITY : summarizes
    USERS ||--o{ TASK_ACTIVITY : attempts
    SESSIONS ||--o{ TASK_ACTIVITY : attributes
    USERS ||--o{ MILESTONES : reaches
    USERS ||--o{ REWARD_TRANSACTIONS : receives
    TASK_ACTIVITY ||--o{ REWARD_TRANSACTIONS : may_generate
    USERS ||--o{ WALLET_TRANSACTIONS : owns
    REWARD_TRANSACTIONS ||--o{ WALLET_TRANSACTIONS : may_post
    USERS ||--o{ WITHDRAWALS : requests
    USERS ||--o{ REFERRALS : invites

    USERS {
        string user_id PK
        datetime registration_datetime
        string account_status
    }
    SESSIONS {
        string session_id PK
        string user_id FK
        datetime session_start
        datetime session_end
    }
    FEATURE_EVENTS {
        string event_id PK
        string user_id FK
        string session_id FK
        datetime event_datetime
        string event_name
        string event_status
    }
    TASK_ACTIVITY {
        string activity_id PK
        string user_id FK
        string task_id
        string session_id FK
        datetime task_started_at
        string task_status
    }
    DAILY_ACTIVITY {
        string user_id PK
        date activity_date PK
        int event_count
        int session_count
    }
    MILESTONES {
        string user_id FK
        string milestone_type
        datetime milestone_datetime
    }
    REWARD_TRANSACTIONS {
        string reward_transaction_id PK
        string user_id FK
        string source_reference
        decimal amount
        string unit
        string status
    }
    WALLET_TRANSACTIONS {
        string wallet_transaction_id PK
        string user_id FK
        string reference_id
        decimal amount
        string unit
        string status
    }
    WITHDRAWALS {
        string withdrawal_id PK
        string user_id FK
        decimal requested_amount
        datetime requested_at
        datetime finalized_at
        string status
    }
    REFERRALS {
        string referral_id PK
        string referring_user_id FK
        string referred_user_id FK
        datetime created_at
        datetime converted_at
        string status
    }
```

## Relationship notes

- Users to sessions/events/tasks/daily activity are proposed one-to-many relationships.
- Sessions to events/tasks are proposed one-to-many; a task may be session-attributable only when the source provides a valid session key.
- Reward and wallet records are transaction entities. Reversals/corrections reference prior transactions; they must not overwrite original events.
- Referrals are a relationship between two user roles and require a distinct referral ID. The invitee may be unknown before registration.
- Many-to-many relationships should use an explicit bridge entity if the product permits multiple attribution sources, task assignments, or referral relationships.

## Evidence and approval

Ten candidate links in the supplied simulated workbooks had zero orphan rows. This is a dataset-level check only. Primary-key uniqueness, event cardinality, late-arriving records, and production foreign-key constraints require owner review. Reward, wallet, withdrawal, and referral entities are proposed and absent from the source workbooks.