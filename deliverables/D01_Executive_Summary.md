# D01 — Executive Summary

**VELOOP Rewards Data Analyst Internship — Task 01**  
**Classification: SIMULATED DATA / PROPOSED PRODUCT REQUIREMENTS**  
**Evidence checked:** assignment PDF and two supplied workbooks, 2026-11-03

## Purpose

This assignment establishes the analytics foundation for a developing rewards and engagement product. The supplied records are explicitly fictional. They are useful for testing ingestion, profiling, relationships, and quality controls, but they are not actual VELOOP user counts, earnings, wallet activity, withdrawals, retention, conversion, or company performance.

The recommended approach is to keep raw inputs unchanged, label simulated and production environments separately, document source and status for every important definition, and require product/engineering approval before treating proposed events, keys, or KPIs as production contracts.

## What was reviewed

The PDF requires 21 deliverables spanning product readiness, user and transaction specifications, event tracking, a 75-field dictionary, logical data model, 30+ KPIs, simulated-data profiling, quality audit and controls, dashboard blueprint, developer handoff, pipeline, privacy/governance, readiness, assumptions, backlog, and final consolidation.

The two supplied workbooks contain 15 worksheets and 103,747 records in total. The user-behavior workbook has simulated user, session, feature-event, daily-activity, task-activity, milestone, feature-usage, dictionary, status, and event-audit sheets. The second workbook has clean and messy user audit sheets, a dictionary, summary, and status notes. Direct identifiers such as full name and email are excluded from generated profiles, previews, and report data.

## Evidence-based findings

- The profiling workbook covers 15 worksheets, 169 columns, 13,765 missing cells, 36 duplicate-row participations, one malformed date value, and 5,619 IQR outlier flags. Outlier flags are review signals, not proof of invalid data.
- The quality audit contains 39 simulated-data findings, including missingness observations, numeric parse failures, duplicate rows/keys, negative values in fields expected to be non-negative by name, category-format inconsistencies, whitespace, and one malformed date.
- Ten configured candidate relationships produced zero orphan rows in this simulated run. This does not establish production constraints or approve automatic joins.
- No standalone reward ledger, wallet transaction, withdrawal, or referral-event worksheet was supplied. User fields and activity flags are not transaction ledgers and cannot support those lifecycle metrics.
- Missing values are not automatically errors. For example, a referral detail can be legitimately absent when the user was not referred; conditional rules require an approved definition.
- The assignment does not establish which events or features are implemented in production, what statuses are approved, what a referral conversion means, or how rewards and wallet transactions are represented.

## Recommendations

1. Confirm production event and data contracts with product and engineering before publishing operational metrics.
2. Establish stable user, event, session, task, reward-transaction, wallet-transaction, withdrawal, and referral identifiers, with idempotent writes and explicit reversal references.
3. Approve a canonical event/status vocabulary, timestamp and timezone convention, nullability rules, and lifecycle transitions.
4. Implement a ledger-backed reward and wallet model, plus a timestamped withdrawal lifecycle; do not derive financial metrics from feature flags.
5. Approve KPI definitions, denominators, reporting windows, and eligibility criteria before calculating values.
6. Minimize personal data in analytical outputs, define access and retention with the appropriate owner, and keep source files out of version control.
7. Treat the current Streamlit app as a local prototype. Authentication, production storage, monitoring, and deployment controls are prerequisites for any hosted use.

## Current conclusion

VELOOP has a useful simulated foundation for testing user, session, task, and feature-event analysis. The supplied data supports a reproducible structural audit, not claims about production performance. The greatest readiness gaps are verified production instrumentation, transaction-level data for rewards/wallet/withdrawals, approved semantic definitions, and stakeholder ownership of data and KPI contracts.

The deliverable tracker, source register, assumption register, backlog, D12/D13 reports, and specification workbooks provide the evidence trail and next steps. Unknowns remain explicit rather than being converted to facts.