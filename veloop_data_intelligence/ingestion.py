from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

import pandas as pd


@dataclass(frozen=True)
class Dataset:
    dataset_id: str
    source_name: str
    sheet_name: str | None
    dataframe: pd.DataFrame


def load_uploaded_file(filename: str, content: bytes) -> list[Dataset]:
    """Load a CSV or every sheet in an Excel workbook as separate datasets."""
    extension = filename.rsplit(".", maxsplit=1)[-1].lower()
    if extension == "csv":
        dataframe = pd.read_csv(BytesIO(content))
        return [Dataset(filename, filename, None, dataframe)]

    if extension in {"xlsx", "xlsm"}:
        sheets = pd.read_excel(BytesIO(content), sheet_name=None, engine="openpyxl")
        return [
            Dataset(f"{filename} / {sheet_name}", filename, sheet_name, dataframe)
            for sheet_name, dataframe in sheets.items()
        ]

    raise ValueError(f"Unsupported file type: .{extension}")