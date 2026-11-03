from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

from veloop_data_intelligence.ingestion import Dataset, load_uploaded_file
from veloop_data_intelligence.privacy import is_sensitive_column
from veloop_data_intelligence.profiling import profile_dataset
from veloop_data_intelligence.quality import (
    DatasetQualityConfig,
    ForeignKeyRule,
    QualityFinding,
    run_quality_checks,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "config" / "projects" / "velooptask01.json"
DEFAULT_OUTPUT = ROOT / "deliverables" / "reports"
DATE_COLUMNS = {"date", "datetime", "timestamp", "_at", "_date", "_time"}
IDENTIFIER_COLUMNS = {"id", "user_id", "event_id", "session_id", "activity_id", "task_id"}
CATEGORY_HINTS = ("status", "platform", "device", "feature", "source", "category", "gender", "country", "state", "flag", "type")
NUMERIC_HINTS = ("age", "count", "duration", "days_", "sequence", "amount", "balance", "xp", "sessions", "events", "features", "tasks", "value")
NONNEGATIVE_HINTS = ("age", "count", "duration", "days_", "sequence", "sessions", "events", "features", "tasks", "frequency")


def _read_datasets(input_dir: Path) -> list[Dataset]:
    datasets = []
    for path in sorted(input_dir.glob("*.xlsx")):
        datasets.extend(load_uploaded_file(path.name, path.read_bytes()))
    return datasets


def _quality_config(settings: dict[str, Any]) -> DatasetQualityConfig:
    foreign_keys = tuple(
        ForeignKeyRule(
            column=rule["column"],
            reference_dataset=rule["reference_dataset"],
            reference_column=rule["reference_column"],
            nullable=rule.get("nullable", True),
        )
        for rule in settings.get("foreign_keys", [])
    )
    return DatasetQualityConfig(
        required_columns=tuple(settings.get("required_columns", [])),
        primary_key=settings.get("primary_key"),
        foreign_keys=foreign_keys,
    )


def _inventory_row(dataset: Dataset, config: dict[str, Any]) -> dict[str, Any]:
    dataframe = dataset.dataframe
    primary_key = config.get("primary_key")
    if isinstance(primary_key, str):
        primary_key = [primary_key]
    primary_key = primary_key or []
    key_present = bool(primary_key) and all(column in dataframe.columns for column in primary_key)
    key_duplicate_rows = (
        int(dataframe[primary_key].duplicated(keep=False).sum()) if key_present else None
    )
    return {
        "dataset": dataset.dataset_id,
        "source_file": dataset.source_name,
        "sheet": dataset.sheet_name or "CSV",
        "classification": "SIMULATED",
        "records": len(dataframe),
        "columns": len(dataframe.columns),
        "duplicate_rows": int(dataframe.duplicated(keep=False).sum()),
        "candidate_primary_key": ", ".join(primary_key),
        "key_duplicate_rows": key_duplicate_rows,
    }


def _column_profile(dataset: Dataset) -> pd.DataFrame:
    profile = profile_dataset(dataset.dataframe)
    profile.insert(0, "dataset", dataset.dataset_id)
    profile.insert(1, "source_file", dataset.source_name)
    return profile


def _category_distributions(dataset: Dataset) -> list[dict[str, Any]]:
    rows = []
    for column in dataset.dataframe.columns:
        normalized = str(column).casefold()
        if is_sensitive_column(column) or normalized in IDENTIFIER_COLUMNS or normalized.endswith("_id"):
            continue
        if not any(hint in normalized for hint in CATEGORY_HINTS):
            continue
        counts = dataset.dataframe[column].astype("string").fillna("(missing)").value_counts()
        if 1 < len(counts) <= 100:
            rows.extend(
                {
                    "dataset": dataset.dataset_id,
                    "field": str(column),
                    "category": str(category),
                    "records": int(count),
                }
                for category, count in counts.items()
            )
    return rows


def _quality_records(
    datasets: list[Dataset],
    dataset_config: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    dataframes = {dataset.dataset_id: dataset.dataframe for dataset in datasets}
    all_findings: list[dict[str, Any]] = []
    relationship_rows: list[dict[str, Any]] = []

    for dataset in datasets:
        settings = dataset_config.get(dataset.dataset_id, {})
        findings = run_quality_checks(
            dataset.dataset_id,
            dataset.dataframe,
            _quality_config(settings),
            dataframes,
        )
        all_findings.extend(_finding_record(finding) for finding in findings)
        all_findings.extend(_additional_findings(dataset, settings))

        for relation in settings.get("foreign_keys", []):
            reference = dataframes.get(relation["reference_dataset"])
            if relation["column"] not in dataset.dataframe.columns or reference is None:
                continue
            if relation["reference_column"] not in reference.columns:
                continue
            foreign_values = dataset.dataframe[relation["column"]]
            known_values = reference[relation["reference_column"]].dropna()
            non_null = foreign_values.notna()
            orphans = non_null & ~foreign_values.isin(known_values)
            relationship_rows.append(
                {
                    "dataset": dataset.dataset_id,
                    "field": relation["column"],
                    "reference_dataset": relation["reference_dataset"],
                    "reference_field": relation["reference_column"],
                    "non_null_keys": int(non_null.sum()),
                    "orphan_rows": int(orphans.sum()),
                    "status": "FAIL" if orphans.any() else "PASS",
                    "note": "Candidate relationship; business approval is still required.",
                }
            )
    return all_findings, relationship_rows


def _finding_record(finding: QualityFinding) -> dict[str, Any]:
    cause = {
        "duplicate_rows": "Repeated source rows or duplicate synthetic test records.",
        "duplicate_primary_key": "Primary key is not unique in the supplied sheet.",
        "primary_key_values_missing": "A record is missing the configured key.",
        "required_values_missing": "A configured required field is null.",
        "foreign_key_orphan": "A non-null key has no matching value in its configured reference sheet.",
        "foreign_key_null": "A nullable relationship key is absent.",
    }.get(finding.code, "A configured or generic quality observation was detected.")
    correction = {
        "duplicate_rows": "Review the affected records against source lineage; never delete them silently.",
        "duplicate_primary_key": "Resolve identity or event idempotency before using the key for joins.",
        "primary_key_values_missing": "Trace the source record and repair or quarantine under an approved rule.",
        "required_values_missing": "Confirm whether the field is truly mandatory, then correct upstream or document a valid exception.",
        "foreign_key_orphan": "Check source timing and key mapping; do not fabricate a parent record.",
    }.get(finding.code, "Review with the data owner; do not silently modify source data.")
    status = "OPEN" if finding.status == "FAIL" else finding.status
    return {
        "issue_id": "",
        "dataset": finding.dataset_id,
        "field": finding.column or "",
        "issue_type": finding.code,
        "records_affected": finding.affected_rows,
        "severity": finding.severity,
        "detection_logic": finding.message,
        "likely_cause": cause,
        "correction": correction,
        "prevention": "Validate at ingestion and retain an auditable correction trail.",
        "owner": "Proposed: Data Engineering / Analytics",
        "status": status,
        "sample_row_numbers": ", ".join(map(str, finding.row_numbers)),
    }


def _additional_findings(dataset: Dataset, settings: dict[str, Any]) -> list[dict[str, Any]]:
    dataframe = dataset.dataframe
    findings = []
    baseline_id = settings.get("status_baseline")
    baseline = settings.get("_baseline_dataframe")

    for column in dataframe.columns:
        values = dataframe[column]
        name = str(column)
        normalized_name = name.casefold()
        if pd.api.types.is_object_dtype(values) or pd.api.types.is_string_dtype(values):
            text = values.dropna().astype(str)
            trailing_space_rows = values.notna() & values.astype("string").ne(values.astype("string").str.strip())
            if trailing_space_rows.any():
                findings.append(
                    _manual_finding(dataset.dataset_id, name, "trailing_or_leading_whitespace", int(trailing_space_rows.sum()), "LOW", "String values differ from their trimmed form.", "Trim only after preserving the original value and validating the correction.")
                )
            if "status" in normalized_name and baseline is not None and column in baseline.columns:
                allowed = set(baseline[column].dropna().astype(str).str.strip().str.casefold())
                candidate = values.astype("string").str.strip().str.casefold()
                invalid = values.notna() & ~candidate.isin(allowed)
                if invalid.any():
                    findings.append(
                        _manual_finding(dataset.dataset_id, name, "status_not_in_clean_reference", int(invalid.sum()), "MEDIUM", f"Compared normalized values with the corresponding clean simulated sheet {baseline_id}.", "Confirm the allowed status domain with the product owner before enforcing it.")
                    )
            if any(hint in normalized_name for hint in CATEGORY_HINTS):
                normalized = values.dropna().astype(str).str.strip().str.casefold()
                raw_values = values.dropna().astype(str)
                normalized_groups: dict[str, set[str]] = {}
                for raw, canonical in zip(raw_values, normalized):
                    normalized_groups.setdefault(canonical, set()).add(raw)
                inconsistent = {
                    value
                    for variants in normalized_groups.values()
                    if len(variants) > 1
                    for value in variants
                }
                capitalization_rows = int(values.astype("string").isin(inconsistent).sum())
                if capitalization_rows:
                    findings.append(
                        _manual_finding(dataset.dataset_id, name, "inconsistent_category_format", capitalization_rows, "LOW", "Counted category rows belonging to case/whitespace variants of the same normalized label.", "Approve a canonical category vocabulary and normalize at ingestion.")
                    )

        if any(hint in normalized_name for hint in NUMERIC_HINTS):
            converted = pd.to_numeric(values, errors="coerce")
            invalid_numeric = values.notna() & converted.isna()
            if invalid_numeric.any():
                findings.append(
                    _manual_finding(dataset.dataset_id, name, "invalid_numeric_value", int(invalid_numeric.sum()), "HIGH", "Non-null values in a numeric-looking field failed numeric parsing.", "Confirm units and accepted formats, then repair or quarantine invalid values.")
                )
            if any(hint in normalized_name for hint in NONNEGATIVE_HINTS):
                negative = converted.lt(0).fillna(False)
                if negative.any():
                    findings.append(
                        _manual_finding(dataset.dataset_id, name, "negative_nonnegative_measure", int(negative.sum()), "MEDIUM", "Detected values below zero in a field that is expected to be non-negative by its name.", "Confirm the domain and unit with the data owner before applying a non-negative constraint.")
                    )

        if "date" in normalized_name or "time" in normalized_name or "timestamp" in normalized_name:
            parsed = pd.to_datetime(values, errors="coerce", format="mixed", utc=True)
            malformed = values.notna() & parsed.isna()
            if malformed.any():
                findings.append(
                    _manual_finding(dataset.dataset_id, name, "malformed_date", int(malformed.sum()), "HIGH", "Non-null values in a date/time-named field failed mixed-format datetime parsing.", "Confirm format and timezone expectations, then repair or quarantine invalid values.")
                )

        if name != name.strip() or "  " in name:
            findings.append(
                _manual_finding(dataset.dataset_id, name, "inconsistent_column_name", len(dataframe), "LOW", "Column name contains surrounding or repeated whitespace.", "Publish a canonical snake_case field name and alias the source field explicitly.")
            )

    return findings


def _manual_finding(
    dataset_id: str,
    column: str,
    issue_type: str,
    affected: int,
    severity: str,
    detection: str,
    correction: str,
) -> dict[str, Any]:
    return {
        "issue_id": "",
        "dataset": dataset_id,
        "field": column,
        "issue_type": issue_type,
        "records_affected": affected,
        "severity": severity,
        "detection_logic": detection,
        "likely_cause": "Simulated test-data variation or upstream formatting inconsistency; not evidence of production behavior.",
        "correction": correction,
        "prevention": "Add a documented validation rule at the earliest responsible pipeline stage.",
        "owner": "Proposed: Data Engineering / Analytics",
        "status": "OPEN",
        "sample_row_numbers": "",
    }


def _format_workbook(path: Path) -> None:
    workbook = load_workbook(path)
    header_fill = PatternFill("solid", fgColor="173C3A")
    for sheet in workbook.worksheets:
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        for cell in sheet[1]:
            cell.font = Font(color="FFFFFF", bold=True)
            cell.fill = header_fill
            cell.alignment = Alignment(vertical="top", wrap_text=True)
        for column_cells in sheet.columns:
            column_letter = column_cells[0].column_letter
            longest = max((len(str(cell.value or "")) for cell in column_cells[:100]), default=10)
            sheet.column_dimensions[column_letter].width = min(max(longest + 2, 12), 44)
    workbook.save(path)


def _write_profile_workbook(
    path: Path,
    datasets: list[Dataset],
    config: dict[str, Any],
    findings: list[dict[str, Any]],
    relationships: list[dict[str, Any]],
) -> None:
    dataset_config = config["datasets"]
    inventory = pd.DataFrame(
        [_inventory_row(dataset, dataset_config.get(dataset.dataset_id, {})) for dataset in datasets]
    )
    profiles = pd.concat([_column_profile(dataset) for dataset in datasets], ignore_index=True)
    category_rows = [row for dataset in datasets for row in _category_distributions(dataset)]
    status_rows = [finding for finding in findings if "status" in finding["issue_type"]]
    metadata = pd.DataFrame(
        [
            {"item": "Project", "value": config["project"]["name"]},
            {"item": "Classification", "value": "SIMULATED"},
            {"item": "Production data", "value": "No"},
            {"item": "Generated at (UTC)", "value": datetime.now(timezone.utc).isoformat()},
            {"item": "Privacy", "value": "No source records or direct-identifier values are included."},
            {"item": "Limitations", "value": "Profiles describe supplied simulated sheets only; absent domains are not zero activity."},
        ]
    )
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        metadata.to_excel(writer, sheet_name="Read Me", index=False)
        inventory.to_excel(writer, sheet_name="Dataset Inventory", index=False)
        profiles.to_excel(writer, sheet_name="Column Profile", index=False)
        pd.DataFrame(category_rows, columns=["dataset", "field", "category", "records"]).to_excel(
            writer, sheet_name="Category Distribution", index=False
        )
        pd.DataFrame(relationships).to_excel(writer, sheet_name="Relationship Checks", index=False)
        pd.DataFrame(status_rows).to_excel(writer, sheet_name="Status Findings", index=False)
    _format_workbook(path)


def _write_quality_workbook(path: Path, findings: list[dict[str, Any]], relationships: list[dict[str, Any]]) -> None:
    findings_frame = pd.DataFrame(findings)
    if not findings_frame.empty:
        findings_frame["issue_id"] = [f"DQ-{index:04d}" for index in range(1, len(findings_frame) + 1)]
    else:
        findings_frame = pd.DataFrame(
            columns=["issue_id", "dataset", "field", "issue_type", "records_affected", "severity", "detection_logic", "likely_cause", "correction", "prevention", "owner", "status", "sample_row_numbers"]
        )
    controls = pd.DataFrame(
        [
            {"rule_area": "Identifier format and presence", "control_stage": "Application / ingestion", "control": "Validate required IDs; retain source lineage and reject or quarantine invalid records.", "owner": "Proposed: Engineering"},
            {"rule_area": "Allowed statuses", "control_stage": "Collection / transformation", "control": "Validate against a product-approved versioned enumeration; do not derive production rules from simulated values alone.", "owner": "Proposed: Product and Engineering"},
            {"rule_area": "Timestamp format and timezone", "control_stage": "Ingestion", "control": "Parse explicit formats and timezone; quarantine non-null malformed timestamps.", "owner": "Proposed: Data Engineering"},
            {"rule_area": "Duplicate event/transaction IDs", "control_stage": "Application / raw data", "control": "Use stable event IDs and idempotent writes; report duplicates without silent deletion.", "owner": "Proposed: Engineering"},
            {"rule_area": "Referential integrity", "control_stage": "Transformation", "control": "Validate foreign keys against the appropriate entity snapshot and distinguish late-arriving records from permanent orphans.", "owner": "Proposed: Data Engineering"},
            {"rule_area": "Conditional nullability", "control_stage": "Application / analytics layer", "control": "Encode approved conditions so legitimately optional fields are not treated as failures.", "owner": "Proposed: Product and Analytics"},
        ]
    )
    unassessed = pd.DataFrame(
        [
            {"check": "Impossible state transitions", "status": "NOT EVALUATED", "reason": "Supplied sheets are snapshots/events without a confirmed transition contract."},
            {"check": "Invalid production status values", "status": "NOT EVALUATED", "reason": "No approved production status enumeration was supplied; simulated clean-sheet comparisons are only diagnostic."},
            {"check": "Negative wallet/transaction amounts", "status": "NOT EVALUATED", "reason": "No wallet ledger or approved reversal/sign convention was supplied."},
            {"check": "Production event coverage", "status": "NOT EVALUATED", "reason": "No production event catalogue or instrumentation evidence was supplied."},
        ]
    )
    metadata = pd.DataFrame(
        [
            {"item": "Classification", "value": "SIMULATED"},
            {"item": "Purpose", "value": "Audit of supplied fictional datasets for analytical testing."},
            {"item": "Integrity", "value": "No issue should be interpreted as a production VELOOP defect."},
            {"item": "Source handling", "value": "Raw records and direct-identifier values are not included."},
            {"item": "Correction policy", "value": "Findings are recommendations; source rows are never silently changed or removed."},
        ]
    )
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        metadata.to_excel(writer, sheet_name="Read Me", index=False)
        findings_frame.to_excel(writer, sheet_name="Quality Findings", index=False)
        pd.DataFrame(relationships).to_excel(writer, sheet_name="Relationship Checks", index=False)
        controls.to_excel(writer, sheet_name="Quality Controls", index=False)
        unassessed.to_excel(writer, sheet_name="Not Evaluated", index=False)
    _format_workbook(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build privacy-preserving VELOOP Task 01 audit workbooks.")
    parser.add_argument("--input-dir", type=Path, default=ROOT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    args = parser.parse_args()

    config = json.loads(args.config.read_text(encoding="utf-8"))
    datasets = _read_datasets(args.input_dir)
    dataset_config = config["datasets"]
    baselines = {
        dataset_id: datasets_by_id.dataframe
        for dataset_id in dataset_config
        for datasets_by_id in datasets
        if dataset_id == datasets_by_id.dataset_id
    }
    for dataset in datasets:
        settings = dataset_config.get(dataset.dataset_id, {})
        if settings.get("status_baseline") in baselines:
            settings["_baseline_dataframe"] = baselines[settings["status_baseline"]]

    findings, relationships = _quality_records(datasets, dataset_config)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    profile_path = args.output_dir / "D12_Simulated_Data_Profiling.xlsx"
    quality_path = args.output_dir / "D13_Data_Quality_Audit.xlsx"
    _write_profile_workbook(profile_path, datasets, config, findings, relationships)
    _write_quality_workbook(quality_path, findings, relationships)
    print(f"Datasets profiled: {len(datasets)}")
    print(f"Profile workbook: {profile_path}")
    print(f"Quality findings: {len(findings)}")
    print(f"Quality workbook: {quality_path}")


if __name__ == "__main__":
    main()