from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Mapping

import pandas as pd


FindingStatus = Literal["FAIL", "OBSERVATION", "NOT_EVALUATED"]
Severity = Literal["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]


@dataclass(frozen=True)
class ConditionalRequiredRule:
    column: str
    when_column: str
    equals: Any


@dataclass(frozen=True)
class ForeignKeyRule:
    column: str
    reference_dataset: str
    reference_column: str
    nullable: bool = True


@dataclass(frozen=True)
class DatasetQualityConfig:
    required_columns: tuple[str, ...] = ()
    primary_key: str | tuple[str, ...] | None = None
    expected_types: Mapping[str, str] = field(default_factory=dict)
    conditional_required: tuple[ConditionalRequiredRule, ...] = ()
    foreign_keys: tuple[ForeignKeyRule, ...] = ()


@dataclass(frozen=True)
class QualityFinding:
    code: str
    status: FindingStatus
    severity: Severity
    dataset_id: str
    column: str | None
    message: str
    affected_rows: int = 0
    row_numbers: tuple[int, ...] = ()

    def to_record(self) -> dict[str, Any]:
        """Return a report-friendly record without exposing source values."""
        return {
            "code": self.code,
            "status": self.status,
            "severity": self.severity,
            "dataset": self.dataset_id,
            "column": self.column or "",
            "message": self.message,
            "affected_rows": self.affected_rows,
            "sample_row_numbers": ", ".join(map(str, self.row_numbers)),
        }


def _row_numbers(mask: pd.Series, limit: int = 10) -> tuple[int, ...]:
    return tuple(
        position + 1
        for position, matched in enumerate(mask.fillna(False).to_numpy())
        if matched
    )[:limit]


def _append_mask_finding(
    findings: list[QualityFinding],
    *,
    code: str,
    status: FindingStatus,
    severity: Severity,
    dataset_id: str,
    column: str | None,
    message: str,
    mask: pd.Series,
) -> None:
    normalized_mask = mask.fillna(False).astype(bool)
    affected_rows = int(normalized_mask.sum())
    if affected_rows:
        findings.append(
            QualityFinding(
                code=code,
                status=status,
                severity=severity,
                dataset_id=dataset_id,
                column=column,
                message=message,
                affected_rows=affected_rows,
                row_numbers=_row_numbers(normalized_mask),
            )
        )


def _invalid_type_mask(values: pd.Series, expected_type: str) -> pd.Series | None:
    normalized_type = expected_type.strip().lower()
    non_null = values.notna()

    if normalized_type in {"string", "str", "text"}:
        return non_null & ~values.map(lambda value: isinstance(value, str))

    if normalized_type in {"integer", "int", "int64"}:
        converted = pd.to_numeric(values, errors="coerce")
        invalid_parse = non_null & converted.isna()
        fractional = converted.notna() & converted.mod(1).ne(0)
        return invalid_parse | fractional

    if normalized_type in {"number", "numeric", "float", "float64"}:
        converted = pd.to_numeric(values, errors="coerce")
        return non_null & converted.isna()

    if normalized_type in {"boolean", "bool"}:
        accepted = {True, False, 0, 1, "true", "false", "0", "1"}
        return non_null & ~values.map(
            lambda value: value in accepted
            if isinstance(value, (str, int, float, bool))
            else False
        )

    if normalized_type in {"datetime", "date", "timestamp"}:
        converted = pd.to_datetime(values, errors="coerce", format="mixed", utc=True)
        return non_null & converted.isna()

    return None


def run_quality_checks(
    dataset_id: str,
    dataframe: pd.DataFrame,
    config: DatasetQualityConfig | None = None,
    reference_datasets: Mapping[str, pd.DataFrame] | None = None,
) -> list[QualityFinding]:
    """Run configured, non-mutating quality checks and return actionable findings.

    Row numbers are one-based positions in the dataframe, not dataframe index labels.
    Unconfigured missing values are observations; only rule violations fail checks.
    """
    config = config or DatasetQualityConfig()
    reference_datasets = reference_datasets or {}
    findings: list[QualityFinding] = []

    if dataframe.empty:
        findings.append(
            QualityFinding(
                code="empty_dataset",
                status="FAIL",
                severity="HIGH",
                dataset_id=dataset_id,
                column=None,
                message="Dataset contains no records.",
            )
        )

    for column in dataframe.columns:
        missing_mask = dataframe[column].isna()
        _append_mask_finding(
            findings,
            code="missing_values",
            status="OBSERVATION",
            severity="INFO",
            dataset_id=dataset_id,
            column=str(column),
            message="Missing values found; review whether they are permitted.",
            mask=missing_mask,
        )

    duplicate_rows = dataframe.duplicated(keep=False)
    _append_mask_finding(
        findings,
        code="duplicate_rows",
        status="FAIL",
        severity="MEDIUM",
        dataset_id=dataset_id,
        column=None,
        message="Rows participating in exact duplicate groups were found.",
        mask=duplicate_rows,
    )

    for column in config.required_columns:
        if column not in dataframe.columns:
            findings.append(
                QualityFinding(
                    code="required_column_missing",
                    status="FAIL",
                    severity="HIGH",
                    dataset_id=dataset_id,
                    column=column,
                    message="Configured required column is absent.",
                )
            )
            continue
        _append_mask_finding(
            findings,
            code="required_values_missing",
            status="FAIL",
            severity="HIGH",
            dataset_id=dataset_id,
            column=column,
            message="Required column contains missing values.",
            mask=dataframe[column].isna(),
        )

    if config.primary_key is not None:
        primary_key = (config.primary_key,) if isinstance(config.primary_key, str) else config.primary_key
        missing_columns = [column for column in primary_key if column not in dataframe.columns]
        if missing_columns:
            findings.append(
                QualityFinding(
                    code="primary_key_columns_missing",
                    status="FAIL",
                    severity="HIGH",
                    dataset_id=dataset_id,
                    column=", ".join(missing_columns),
                    message="Configured primary key column(s) are absent.",
                )
            )
        else:
            key_values = dataframe[list(primary_key)]
            null_key_rows = key_values.isna().any(axis=1)
            _append_mask_finding(
                findings,
                code="primary_key_values_missing",
                status="FAIL",
                severity="HIGH",
                dataset_id=dataset_id,
                column=", ".join(primary_key),
                message="Primary key contains missing values.",
                mask=null_key_rows,
            )
            duplicate_keys = key_values.duplicated(keep=False) & ~null_key_rows
            _append_mask_finding(
                findings,
                code="duplicate_primary_key",
                status="FAIL",
                severity="CRITICAL",
                dataset_id=dataset_id,
                column=", ".join(primary_key),
                message="Primary key is not unique.",
                mask=duplicate_keys,
            )

    for column, expected_type in config.expected_types.items():
        if column not in dataframe.columns:
            findings.append(
                QualityFinding(
                    code="schema_type_validation",
                    status="NOT_EVALUATED",
                    severity="INFO",
                    dataset_id=dataset_id,
                    column=column,
                    message=f"Cannot validate expected type {expected_type}: column is absent.",
                )
            )
            continue

        invalid_mask = _invalid_type_mask(dataframe[column], expected_type)
        if invalid_mask is None:
            findings.append(
                QualityFinding(
                    code="schema_type_validation",
                    status="NOT_EVALUATED",
                    severity="INFO",
                    dataset_id=dataset_id,
                    column=column,
                    message=f"Unsupported configured type: {expected_type}.",
                )
            )
            continue
        _append_mask_finding(
            findings,
            code="schema_type_invalid",
            status="FAIL",
            severity="HIGH",
            dataset_id=dataset_id,
            column=column,
            message=f"Values do not match the configured {expected_type} type.",
            mask=invalid_mask,
        )

    for rule in config.conditional_required:
        if rule.column not in dataframe.columns or rule.when_column not in dataframe.columns:
            findings.append(
                QualityFinding(
                    code="conditional_required",
                    status="NOT_EVALUATED",
                    severity="INFO",
                    dataset_id=dataset_id,
                    column=rule.column,
                    message="Cannot evaluate conditional requirement because a rule column is absent.",
                )
            )
            continue
        condition = dataframe[rule.when_column].eq(rule.equals).fillna(False)
        missing_when_required = condition & dataframe[rule.column].isna()
        _append_mask_finding(
            findings,
            code="conditional_values_missing",
            status="FAIL",
            severity="HIGH",
            dataset_id=dataset_id,
            column=rule.column,
            message=(
                f"Value is required when the configured condition on "
                f"{rule.when_column} is met."
            ),
            mask=missing_when_required,
        )

    for rule in config.foreign_keys:
        reference = reference_datasets.get(rule.reference_dataset)
        if (
            rule.column not in dataframe.columns
            or reference is None
            or rule.reference_column not in reference.columns
        ):
            findings.append(
                QualityFinding(
                    code="foreign_key_integrity",
                    status="NOT_EVALUATED",
                    severity="INFO",
                    dataset_id=dataset_id,
                    column=rule.column,
                    message="Cannot evaluate foreign key because the source or reference column is unavailable.",
                )
            )
            continue

        foreign_values = dataframe[rule.column]
        null_values = foreign_values.isna()
        if null_values.any():
            findings.append(
                QualityFinding(
                    code="foreign_key_null",
                    status="FAIL" if not rule.nullable else "OBSERVATION",
                    severity="HIGH" if not rule.nullable else "INFO",
                    dataset_id=dataset_id,
                    column=rule.column,
                    message=(
                        "Required foreign key contains missing values."
                        if not rule.nullable
                        else "Nullable foreign key contains missing values."
                    ),
                    affected_rows=int(null_values.sum()),
                    row_numbers=_row_numbers(null_values),
                )
            )

        reference_values = reference[rule.reference_column].dropna()
        orphan_values = foreign_values.notna() & ~foreign_values.isin(reference_values)
        _append_mask_finding(
            findings,
            code="foreign_key_orphan",
            status="FAIL",
            severity="HIGH",
            dataset_id=dataset_id,
            column=rule.column,
            message=(
                f"Values do not exist in {rule.reference_dataset}."
                f"{rule.reference_column}."
            ),
            mask=orphan_values,
        )

    return findings