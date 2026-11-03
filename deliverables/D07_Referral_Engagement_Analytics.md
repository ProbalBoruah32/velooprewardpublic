# D07 — Referral and Engagement Analytics

**Status:** proposed; all supplied records are simulated.

## Referral funnel

Keep these stages distinct: `referral_created -> referral_registered -> referral_activated -> referral_converted`. Registration alone does not establish activation or conversion. Product must define eligibility and conversion criteria.

Proposed fields: `referral_id`, `referring_user_id`, `referred_user_id` (where permitted), created/registered/activated/converted timestamps, source, and approved status. Preserve attribution rules and prevent self-referral or duplicate attribution only through approved product rules; do not invent fraud thresholds.

The supplied user sheets contain referral code/source attributes, but no dedicated referral event table or lifecycle timestamps. Referral funnel KPIs are therefore blocked. Source attributes are not proof that an invitation converted.

## Engagement

Potential measures: feature adoption, repeat usage, session frequency/duration, daily activity, task participation/completion, and milestone activity. Define qualifying events, active-user windows, timezone, deduplication, and eligible population before publishing rates. Use pseudonymous IDs and aggregate dimensions; suppress direct identifiers.

The simulated sessions, feature events, daily activity, task activity, and milestones support structural exploration. They do not prove production feature adoption or engagement performance.