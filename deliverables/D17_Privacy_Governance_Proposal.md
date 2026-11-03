# D17 — Privacy and Governance Proposal

**Status:** proposed controls; legal, privacy, and product approval required.

## Data minimization

- Prefer opaque IDs and analytical attributes. Do not collect names, emails, passwords, API keys, payment credentials, authentication secrets, or payout credentials in analytics events.
- Treat full name/email fields in the supplied simulated user sheet as direct identifiers. The profiling/export code omits their values and records the exclusion in `Privacy Notes`.
- Keep simulated and production environments separate and visibly classified. Never combine them silently.
- Aggregate geography and other attributes to the minimum granularity needed for an approved question.

## Proposed access model

| Role | Proposed access |
| --- | --- |
| Engineering | Event contracts and technical diagnostics; no unnecessary raw personal data |
| Data/Analytics | Approved pseudonymous analytical datasets and aggregate reporting |
| Product/Operations | Aggregated product measures and approved drill-downs |
| Content team | Aggregated content performance only where needed |
| Intern | Approved/sanitized simulated or production extracts only |
| Privacy/legal | Policy review and authorized access audits |

Use least privilege, named accounts, periodic access review, and auditable export controls. Authentication is required before any public deployment; this local prototype is not an authenticated service.

## Retention and rights

No retention period, consent policy, deletion process, or jurisdictional legal basis was supplied. Do not invent a duration. Privacy/legal and the data owner must approve retention, deletion, subject-request handling, and any production use before data is loaded to a hosted environment.

## Operational protections

Keep uploaded workbooks and generated reports out of Git; the project ignores common data/report output paths. Avoid logging source rows or credentials. Validate extensions, workbook size, and parsing limits before production exposure. Protect exports, apply HTTPS and secure configuration when hosted, and review access to downloaded reports.