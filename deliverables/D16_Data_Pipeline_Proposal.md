# D16 — Data Pipeline and Operating Model

**Status:** proposed practical architecture for a developing product; not a claim about current VELOOP infrastructure.

## Proposed flow

```text
VELOOP application and approved providers
  -> versioned application/backend events
  -> immutable raw landing (separate simulated/production environments)
  -> schema and quality validation / quarantine
  -> deduplication and identity/reference checks
  -> documented transformations and analytical tables
  -> dashboards and versioned Excel/report exports
```

Start with the least operationally complex storage and scheduling that meets volume, access, and recovery needs. Add a database or managed warehouse only when concurrency, retention, audit, or scale justifies it; do not introduce costly infrastructure by default.

## Operating controls

- Record source, schema version, ingest time, event time, run ID, classification, and row counts.
- Preserve raw input and never silently overwrite or clean source records.
- Route malformed schema, timestamps, IDs, and failed integrity checks to a restricted quarantine with non-sensitive diagnostics.
- Make transformations deterministic and version-controlled; publish definitions alongside derived metrics.
- Reconcile record counts and transaction totals where authoritative ledgers exist.
- Monitor ingestion freshness, rejection/quarantine counts, duplicate IDs, orphan rates, and job failures.
- Retry transient failures idempotently; alert the assigned owner and preserve failed-run context without logging personal values or credentials.
- Refresh cadence and retention must be approved by product, engineering, and privacy owners; neither is inferred here.

## Ownership (proposed)

Engineering owns producers, identifiers, raw capture, and reliability. Data/Analytics owns validation, transformations, definitions, and report QA. Product owns event semantics and KPI meaning. Privacy/legal approves access and retention. Named owners are still to be assigned.