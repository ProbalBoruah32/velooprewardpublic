from __future__ import annotations

from io import BytesIO
import re
from typing import Mapping

import pandas as pd

from veloop_data_intelligence.ingestion import Dataset
from veloop_data_intelligence.profiling import profile_dataset
from veloop_data_intelligence.privacy import without_sensitive_columns
from veloop_data_intelligence.quality import DatasetQualityConfig, run_quality_checks


_FORMULA_PREFIX = re.compile(r"^[\t\r\n ]*[=+\-@]")


def _sheet_name(value: str, used_names: set[str]) -> str:
    base_name = re.sub(r"[\\/*?:\[\]]", "_", value).strip("'") or "Dataset"
    base_name = base_name[:31]
    candidate = base_name
    suffix = 2
    while candidate.casefold() in used_names:
        suffix_text = f"_{suffix}"
        candidate = f"{base_name[:31 - len(suffix_text)]}{suffix_text}"
        suffix += 1
    used_names.add(candidate.casefold())
    return candidate


def _excel_safe_dataframe(dataframe: pd.DataFrame) -> pd.DataFrame:
    safe_dataframe = dataframe.copy()
    for column in safe_dataframe.columns:
        safe_dataframe[column] = safe_dataframe[column].map(
            lambda value: f"'{value}"
            if isinstance(value, str) and _FORMULA_PREFIX.match(value)
            else value
        )
    return safe_dataframe


def build_audit_workbook(
    datasets: list[Dataset],
    quality_configs: Mapping[str, DatasetQualityConfig] | None = None,
) -> bytes:
    """Create an Excel workbook containing source data and audit findings."""
    output = BytesIO()
    inventory_rows = []
    profile_rows = []
    quality_rows = []
    privacy_rows = []
    quality_configs = quality_configs or {}
    reference_datasets = {
        dataset.dataset_id: dataset.dataframe for dataset in datasets
    }
    used_names = {"inventory", "column profile", "quality findings"}

    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        for dataset in datasets:
            inventory_rows.append(
                {
                    "dataset": dataset.dataset_id,
                    "source_file": dataset.source_name,
                    "sheet": dataset.sheet_name or "CSV",
                    "rows": len(dataset.dataframe),
                    "columns": len(dataset.dataframe.columns),
                    "duplicate_rows": int(dataset.dataframe.duplicated().sum()),
                }
            )
            dataset_profile = profile_dataset(dataset.dataframe)
            dataset_profile.insert(0, "dataset", dataset.dataset_id)
            profile_rows.append(dataset_profile)
            dataset_findings = run_quality_checks(
                dataset.dataset_id,
                dataset.dataframe,
                quality_configs.get(dataset.dataset_id),
                reference_datasets,
            )
            quality_rows.extend(finding.to_record() for finding in dataset_findings)
            report_dataframe, excluded_columns = without_sensitive_columns(dataset.dataframe)
            privacy_rows.extend(
                {
                    "dataset": dataset.dataset_id,
                    "excluded_field": column,
                    "reason": "Direct-identifier field excluded from report output.",
                }
                for column in excluded_columns
            )
            _excel_safe_dataframe(report_dataframe).to_excel(
                writer,
                sheet_name=_sheet_name(dataset.dataset_id, used_names),
                index=False,
            )

        pd.DataFrame(inventory_rows).to_excel(writer, sheet_name="Inventory", index=False)
        profiles = (
            pd.concat(profile_rows, ignore_index=True)
            if profile_rows
            else pd.DataFrame(columns=["dataset", *profile_dataset(pd.DataFrame()).columns])
        )
        profiles.to_excel(writer, sheet_name="Column Profile", index=False)
        quality_columns = [
            "code",
            "status",
            "severity",
            "dataset",
            "column",
            "message",
            "affected_rows",
            "sample_row_numbers",
        ]
        pd.DataFrame(quality_rows, columns=quality_columns).to_excel(
            writer,
            sheet_name="Quality Findings",
            index=False,
        )
        pd.DataFrame(
            privacy_rows,
            columns=["dataset", "excluded_field", "reason"],
        ).to_excel(writer, sheet_name="Privacy Notes", index=False)

    return output.getvalue()