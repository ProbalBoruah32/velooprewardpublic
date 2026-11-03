from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st

from veloop_data_intelligence.exporting import build_audit_workbook
from veloop_data_intelligence.ingestion import Dataset, load_uploaded_file
from veloop_data_intelligence.profiling import profile_dataset


st.set_page_config(page_title="VELOOP Data Intelligence", page_icon="V", layout="wide")
st.title("VELOOP Data Intelligence Platform")
st.caption("Upload datasets to inspect their structure, completeness, and quality signals.")

uploads = st.file_uploader(
    "Upload CSV or Excel workbooks",
    type=["csv", "xlsx", "xlsm"],
    accept_multiple_files=True,
)

if not uploads:
    st.info("Choose one or more CSV or Excel files to begin.")
    st.stop()

datasets: list[Dataset] = []
for upload in uploads:
    try:
        datasets.extend(load_uploaded_file(upload.name, upload.getvalue()))
    except Exception as error:
        st.error(f"Could not read {upload.name}: {error}")

if not datasets:
    st.warning("No datasets could be read from the uploaded files.")
    st.stop()

inventory = pd.DataFrame(
    [
        {
            "Dataset": dataset.dataset_id,
            "Source file": dataset.source_name,
            "Sheet": dataset.sheet_name or "CSV",
            "Rows": len(dataset.dataframe),
            "Columns": len(dataset.dataframe.columns),
            "Duplicate rows": int(dataset.dataframe.duplicated().sum()),
        }
        for dataset in datasets
    ]
)

st.subheader("Dataset inventory")
st.dataframe(inventory, use_container_width=True, hide_index=True)

selected_id = st.selectbox("Inspect dataset", [dataset.dataset_id for dataset in datasets])
selected = next(dataset for dataset in datasets if dataset.dataset_id == selected_id)
profile = profile_dataset(selected.dataframe)
duplicate_rows = int(selected.dataframe.duplicated().sum())
missing_cells = int(profile["missing_count"].sum())

first_metric, second_metric, third_metric = st.columns(3)
first_metric.metric("Rows", f"{len(selected.dataframe):,}")
second_metric.metric("Missing cells", f"{missing_cells:,}")
third_metric.metric("Duplicate rows", f"{duplicate_rows:,}")

st.subheader("Column profile")
st.dataframe(profile, use_container_width=True, hide_index=True)

if not profile.empty:
    missing_chart = px.bar(
        profile.sort_values("missing_pct", ascending=False),
        x="column",
        y="missing_pct",
        labels={"column": "Column", "missing_pct": "Missing (%)"},
        title="Missing values by column",
    )
    missing_chart.update_layout(xaxis_tickangle=-35, yaxis_range=[0, 100])
    st.plotly_chart(missing_chart, use_container_width=True)

with st.expander("Preview selected dataset"):
    st.dataframe(selected.dataframe.head(100), use_container_width=True, hide_index=True)

workbook = build_audit_workbook(datasets)
st.download_button(
    "Download Excel audit workbook",
    data=workbook,
    file_name="data_audit.xlsx",
    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
)