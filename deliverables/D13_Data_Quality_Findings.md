# D13 — Simulated Data Quality Audit

**Classification: SIMULATED.** Findings below describe supplied fictional test data. They are not evidence of production VELOOP defects.

## Summary

The audit generator emitted 39 issue records across the supplied sheets: 2 critical, 12 high, 4 medium, 3 low, and 18 informational. Counts are findings, not unique root causes. Missingness is informational unless an explicit rule establishes that a field is required.

| Issue type | Finding records |
| --- | ---: |
| Missing-value observations | 17 |
| Invalid numeric values | 11 |
| Negative values in fields expected to be non-negative by name | 2 |
| Exact duplicate-row groups | 2 |
| Duplicate configured primary-key groups | 2 |
| Inconsistent category formatting | 2 |
| Malformed date values | 1 |
| Nullable foreign-key missingness | 1 |
| Leading/trailing whitespace | 1 |

Ten candidate foreign-key relationships were evaluated and had zero orphan rows. No status value outside the matched clean simulated sheet was detected after trimming and case normalization; this is not an approved production status domain.

## Interpretation and controls

- The audit preserves source files and reports counts, fields, and limited row positions; it does not copy source records into the report.
- Direct identifiers are omitted from generated report values. The `Privacy Notes` sheet in the downloadable audit workbook records omitted fields.
- Duplicate and malformed values are findings for review; the system never silently deletes or repairs source records.
- Conditional missingness requires a configured business rule. Nulls in optional fields are not automatically failures.
- The `Quality Controls` sheet maps proposed controls to application, ingestion, transformation, and analytics stages.
- Impossible state transitions, production status validity, wallet amount rules, and production instrumentation coverage are explicitly `NOT EVALUATED` because approved lifecycle contracts or source data were not supplied.
- Negative-value rules are heuristic screens based on field names and must be confirmed by the data owner before enforcement.

## Reproducibility

Run from the repository root:

```powershell
python -m deliverables.build_data_audits
```

The generated issue-level workbook is `deliverables/reports/D13_Data_Quality_Audit.xlsx`. Its `Quality Findings` sheet includes issue ID, dataset, field, issue type, count, severity, detection logic, likely cause, correction, prevention, proposed owner, status, and sample row positions.