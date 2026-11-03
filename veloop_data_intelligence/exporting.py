from __future__ import annotations

from io import BytesIO
import re

import pandas as pd

from veloop_data_intelligence.ingestion import Dataset
from veloop_data_intelligence.profiling import profile_dataset


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


def build_audit_workbook(datasets: list[Dataset]) -> bytes:
    """Create an Excel workbook containing inventory, profiles, and source data."""
    output = BytesIO()
    inventory_rows = []
    profile_rows = []
    used_names = {"inventory", "column profile"}

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
            dataset.dataframe.to_excel(
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

    return output.getvalue()