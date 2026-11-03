from __future__ import annotations

import pandas as pd


def profile_dataset(dataframe: pd.DataFrame) -> pd.DataFrame:
    """Summarize completeness, type, cardinality, and common values per column."""
    row_count = len(dataframe)
    columns = []
    for column_name in dataframe.columns:
        values = dataframe[column_name]
        missing_count = int(values.isna().sum())
        common_values = values.value_counts(dropna=True).head(5)
        numeric_values = values.dropna() if pd.api.types.is_numeric_dtype(values) else None
        columns.append(
            {
                "column": str(column_name),
                "dtype": str(values.dtype),
                "non_null_count": int(values.notna().sum()),
                "missing_count": missing_count,
                "missing_pct": round(missing_count / row_count * 100, 2) if row_count else 0.0,
                "unique_count": int(values.nunique(dropna=True)),
                "numeric_min": numeric_values.min() if numeric_values is not None and not numeric_values.empty else None,
                "numeric_median": numeric_values.median() if numeric_values is not None and not numeric_values.empty else None,
                "numeric_max": numeric_values.max() if numeric_values is not None and not numeric_values.empty else None,
                "top_values": "; ".join(
                    f"{value}: {count}" for value, count in common_values.items()
                ),
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
            "numeric_min",
            "numeric_median",
            "numeric_max",
            "top_values",
        ],
    )