from __future__ import annotations

import re

import pandas as pd


_SENSITIVE_COLUMN_NAMES = {
    "address",
    "dateofbirth",
    "dob",
    "email",
    "emailaddress",
    "firstname",
    "fullname",
    "lastname",
    "mobile",
    "name",
    "phonenumber",
    "telephone",
}


def is_sensitive_column(column_name: object) -> bool:
    normalized_name = re.sub(r"[^a-z0-9]", "", str(column_name).casefold())
    return normalized_name in _SENSITIVE_COLUMN_NAMES


def without_sensitive_columns(dataframe: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Return a copy without common direct-identifier fields and their names."""
    sensitive_columns = [
        str(column) for column in dataframe.columns if is_sensitive_column(column)
    ]
    return dataframe.drop(columns=sensitive_columns).copy(), sensitive_columns