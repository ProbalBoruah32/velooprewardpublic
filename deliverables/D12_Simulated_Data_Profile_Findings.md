# D12 — Simulated Data Profiling Findings

**Classification: SIMULATED.** This report describes the two supplied fictional workbooks only. It is not a report of actual VELOOP user or company performance.

## Scope and method

The profiling generator read every worksheet from both supplied `.xlsx` files without modifying the source workbooks. Direct-identifier columns such as `full_name` and `email` are excluded from report values. The workbook contains inventory, per-column profiles, category distributions, candidate relationship checks, and status findings.

## Inventory totals

| Measure | Result |
| --- | ---: |
| Worksheets profiled | 15 |
| Rows across worksheets | 103,747 |
| Columns across worksheets | 169 |
| Duplicate-row participations | 36 |
| Missing cells | 13,765 |
| Malformed date values detected | 1 |
| IQR outlier flags | 5,619 |

Duplicate-row participations count every row in an exact-duplicate group. IQR outlier flags are review signals, not proof of invalid values. The row/cell totals include dictionary, summary, status, and audit worksheets as well as activity data.

## Coverage observations

- The user-behavior workbook contains users, sessions, feature events, daily activity, task activity, milestones, a feature-usage summary, a data dictionary, status notes, and an event-quality-audit sheet.
- The second workbook contains clean and messy user audit sheets, a data dictionary, a synthetic summary, and status notes.
- There are no standalone reward-ledger, wallet-transaction, withdrawal, or referral-event worksheets. User fields such as referral detail or activity flags do not replace event-level transaction records.
- Missing values are reported as observations. In particular, optional referral details must not be interpreted as errors without an approved conditional rule.
- A date-like column produced one malformed non-null value. See the `Column Profile` sheet for the affected field and per-column summary without row contents.
- Outlier screening uses the 1.5-IQR rule and should be reviewed in context before any quality decision.

## Relationship and KPI limits

Ten configured candidate key relationships were checked across the simulated sheets; zero orphan rows were found in this run. These checks are structural evidence about these files only. A matching key does not prove a production contract or authorize a join; suggested relationships still require owner approval.

The files support structural analysis of user, session, event, daily-activity, task-activity, and milestone records. They do not support production KPIs. Rewards, wallet, withdrawal, and referral conversion metrics remain unavailable unless the relevant event/transaction definitions and data are supplied and approved.

## Reproducibility

Run from the repository root:

```powershell
python -m deliverables.build_data_audits
```

The generated workbook is `deliverables/reports/D12_Simulated_Data_Profiling.xlsx`. The project configuration is `config/projects/velooptask01.json`.