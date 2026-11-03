from __future__ import annotations

import re

import pandas as pd

from veloop_data_intelligence.privacy import is_sensitive_column


def profile_dataset(dataframe: pd.DataFrame) -> pd.DataFrame:
    """Summarize completeness, type, cardinality, and common values per column."""
    row_count = len(dataframe)
    columns = []
    for column_name in dataframe.columns:
        values = dataframe[column_name]
        missing_count = int(values.isna().sum())
        non_null_count = int(values.notna().sum())
        common_values = values.value_counts(dropna=True).head(5)
        numeric_values = values.dropna() if pd.api.types.is_numeric_dtype(values) else None
        unique_count = int(values.nunique(dropna=True))
        date_like = bool(re.search(r"date|time|timestamp", str(column_name), re.IGNORECASE))
        parsed_dates = (
            pd.to_datetime(values, errors="coerce", format="mixed", utc=True)
            if date_like or pd.api.types.is_datetime64_any_dtype(values)
            else None
        )
        numeric_stats = {}
        if numeric_values is not None and not numeric_values.empty:
            numeric_stats = {
                "numeric_min": numeric_values.min(),
                "numeric_max": numeric_values.max(),
                "numeric_mean": numeric_values.mean(),
                "numeric_median": numeric_values.median(),
                "numeric_std": numeric_values.std(),
                "outlier_count": int(
                    (
                        (numeric_values < numeric_values.quantile(0.25) - 1.5 * (numeric_values.quantile(0.75) - numeric_values.quantile(0.25)))
                        | (numeric_values > numeric_values.quantile(0.75) + 1.5 * (numeric_values.quantile(0.75) - numeric_values.quantile(0.25)))
                    ).sum()
                ),
            }
        else:
            numeric_stats = {
                "numeric_min": None,
                "numeric_max": None,
                "numeric_mean": None,
                "numeric_median": None,
                "numeric_std": None,
                "outlier_count": 0,
            }
        date_valid = parsed_dates.dropna() if parsed_dates is not None else pd.Series(dtype="datetime64[ns, UTC]")
        columns.append(
            {
                "column": str(column_name),
                "dtype": str(values.dtype),
                "non_null_count": non_null_count,
                "missing_count": missing_count,
                "missing_pct": round(missing_count / row_count * 100, 2) if row_count else 0.0,
                "unique_count": unique_count,
                "unique_ratio": round(unique_count / non_null_count, 4) if non_null_count else 0.0,
                "is_constant": bool(non_null_count and unique_count == 1),
                "is_high_cardinality": bool(unique_count >= 50 and unique_count / max(non_null_count, 1) >= 0.9),
                **numeric_stats,
                "date_min": date_valid.min().isoformat() if not date_valid.empty else "",
                "date_max": date_valid.max().isoformat() if not date_valid.empty else "",
                "date_invalid_count": (
                    int((values.notna() & parsed_dates.isna()).sum())
                    if parsed_dates is not None
                    else 0
                ),
                "top_values": ""
                if is_sensitive_column(column_name)
                else "; ".join(
                    f"{value}: {count}" for value, count in common_values.items()
                ),
                "sensitive": is_sensitive_column(column_name),
            }
        )
    return pd.DataFrame(
        columns,
        columns=[
            "column",
            "dtype",
            "non_null_count",
            "missing_count",
            "missing_pct",
            "unique_count",
            "unique_ratio",
            "is_constant",
            "is_high_cardinality",
            "numeric_min",
            "numeric_max",
            "numeric_mean",
            "numeric_median",
            "numeric_std",
            "outlier_count",
            "date_min",
            "date_max",
            "date_invalid_count",
            "top_values",
            "sensitive",
        ],
    )