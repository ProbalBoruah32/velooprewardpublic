from __future__ import annotations

import hashlib

import pandas as pd
import plotly.express as px
import streamlit as st

from veloop_data_intelligence import __version__
from veloop_data_intelligence.exporting import build_audit_workbook
from veloop_data_intelligence.ingestion import Dataset, load_uploaded_file
from veloop_data_intelligence.profiling import profile_dataset
from veloop_data_intelligence.privacy import without_sensitive_columns
from veloop_data_intelligence.quality import run_quality_checks


st.set_page_config(page_title="VELOOP Data Intelligence", page_icon="V", layout="wide")
st.markdown(
    """
    <style>
    :root {
        --canvas: #f5f7f5;
        --ink: #172326;
        --muted: #788487;
        --line: #e2e8e5;
        --teal: #087f75;
        --sidebar: #142023;
    }
    [data-testid="stAppViewContainer"] { background: var(--canvas); }
    [data-testid="stHeader"] { background: transparent; }
    .block-container { max-width: 1600px; padding-top: 1.6rem; padding-bottom: 2rem; }
    [data-testid="stSidebar"] { background: var(--sidebar); }
    [data-testid="stSidebar"] [data-testid="stMarkdownContainer"] p,
    [data-testid="stSidebar"] [data-testid="stMarkdownContainer"] h1,
    [data-testid="stSidebar"] [data-testid="stMarkdownContainer"] h2,
    [data-testid="stSidebar"] [data-testid="stMarkdownContainer"] h3,
    [data-testid="stSidebar"] label { color: #e8efed; }
    [data-testid="stSidebar"] [data-testid="stCaptionContainer"] { color: #9eacab; }
    [data-testid="stSidebar"] [data-testid="stRadio"] label {
        border-radius: 6px;
        padding: 0.18rem 0.55rem;
    }
    [data-testid="stSidebar"] [data-testid="stRadio"] label:has(input:checked) {
        background: #293638;
        border-left: 3px solid #54c4b4;
    }
    [data-testid="stMetric"] {
        background: #ffffff;
        border: 1px solid var(--line);
        border-radius: 7px;
        padding: 0.85rem 1rem;
    }
    [data-testid="stMetricLabel"] { color: var(--muted); }
    h1, h2, h3 { color: var(--ink); letter-spacing: 0; }
    h1 { font-size: 1.75rem; }
    [data-testid="stDataFrame"] { border: 1px solid var(--line); border-radius: 6px; }
        [data-testid="stMain"] h1,
        [data-testid="stMain"] h2,
        [data-testid="stMain"] h3,
        [data-testid="stMain"] p,
        [data-testid="stMain"] label,
        [data-testid="stMain"] [data-testid="stCaptionContainer"] {
            color: var(--ink) !important;
        }
        [data-testid="stMain"] input,
        [data-testid="stMain"] textarea,
        [data-testid="stMain"] [data-baseweb="select"] > div {
            background-color: #ffffff !important;
            color: var(--ink) !important;
        }
        [data-testid="stMain"] [data-testid="stAlert"] {
            background: #ffffff;
            border: 1px solid var(--line);
            color: var(--ink) !important;
        }
    </style>
    """,
    unsafe_allow_html=True,
)


def _inventory(datasets: list[Dataset]) -> pd.DataFrame:
    return pd.DataFrame(
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


def _filter_inventory(inventory: pd.DataFrame, query: str) -> pd.DataFrame:
    if not query.strip():
        return inventory
    searchable = inventory.astype("string").fillna("").agg(" ".join, axis=1)
    return inventory[searchable.str.contains(query.strip(), case=False, regex=False)]


def _metric_strip(datasets: list[Dataset], profiles: dict[str, pd.DataFrame], findings: list) -> None:
    total_rows = sum(len(dataset.dataframe) for dataset in datasets)
    missing_cells = sum(
        int(profile["missing_count"].sum()) for profile in profiles.values()
    )
    failed_checks = sum(finding.status == "FAIL" for finding in findings)
    metrics = st.columns(4)
    metrics[0].metric("Datasets", f"{len(datasets):,}")
    metrics[1].metric("Records", f"{total_rows:,}")
    metrics[2].metric("Missing cells", f"{missing_cells:,}")
    metrics[3].metric("Failed checks", f"{failed_checks:,}")


def _render_overview(
    datasets: list[Dataset],
    inventory: pd.DataFrame,
    selected: Dataset,
    selected_profile: pd.DataFrame,
    profiles: dict[str, pd.DataFrame],
    findings: list,
    search: str,
) -> None:
    _metric_strip(datasets, profiles, findings)

    chart_left, chart_right = st.columns([1.25, 1])
    with chart_left, st.container(border=True):
        st.subheader("Records by dataset")
        records_chart = px.bar(
            inventory.sort_values("Rows", ascending=False),
            x="Dataset",
            y="Rows",
            color_discrete_sequence=["#087f75"],
            template="plotly_white",
        )
        records_chart.update_layout(
            margin=dict(l=8, r=8, t=10, b=8),
            xaxis_title=None,
            yaxis_title="Records",
            showlegend=False,
        )
        st.plotly_chart(records_chart, use_container_width=True, config={"displayModeBar": False})

    with chart_right, st.container(border=True):
        st.subheader("Missing values by field")
        missing_profile = selected_profile[selected_profile["missing_count"] > 0]
        if missing_profile.empty:
            st.caption(f"No missing values found in {selected.dataset_id}.")
        else:
            missing_chart = px.bar(
                missing_profile.sort_values("missing_pct"),
                x="missing_pct",
                y="column",
                orientation="h",
                labels={"column": "Field", "missing_pct": "Missing (%)"},
                color_discrete_sequence=["#48a99d"],
                template="plotly_white",
            )
            missing_chart.update_layout(
                margin=dict(l=8, r=8, t=10, b=8),
                xaxis_title="Missing (%)",
                yaxis_title=None,
                showlegend=False,
            )
            st.plotly_chart(missing_chart, use_container_width=True, config={"displayModeBar": False})

    st.subheader("Dataset inventory")
    visible_inventory = _filter_inventory(inventory, search)
    st.dataframe(visible_inventory, use_container_width=True, hide_index=True)


def _render_analytics(selected: Dataset, profile: pd.DataFrame) -> None:
    st.caption("Explore distributions from the selected dataset. Business KPIs require approved definitions.")
    if selected.dataframe.empty or len(selected.dataframe.columns) == 0:
        st.info("This dataset has no columns to chart.")
        return

    field_name = st.selectbox("Field", list(selected.dataframe.columns), key="analytics_field")
    values = selected.dataframe[field_name]
    if pd.api.types.is_numeric_dtype(values):
        chart = px.histogram(
            selected.dataframe,
            x=field_name,
            nbins=30,
            labels={field_name: field_name, "count": "Records"},
            color_discrete_sequence=["#087f75"],
            template="plotly_white",
        )
    elif pd.api.types.is_datetime64_any_dtype(values):
        dated = values.dropna().dt.date.value_counts().sort_index()
        chart = px.line(
            x=dated.index,
            y=dated.values,
            labels={"x": field_name, "y": "Records"},
            markers=True,
            template="plotly_white",
        )
        chart.update_traces(line_color="#087f75")
    else:
        counts = (
            values.astype("string")
            .fillna("(missing)")
            .value_counts()
            .head(20)
            .rename_axis("Value")
            .reset_index(name="Records")
        )
        chart = px.bar(
            counts.sort_values("Records"),
            x="Records",
            y="Value",
            orientation="h",
            color_discrete_sequence=["#087f75"],
            template="plotly_white",
        )

    chart.update_layout(margin=dict(l=8, r=8, t=10, b=8), showlegend=False)
    st.plotly_chart(chart, use_container_width=True, config={"displayModeBar": False})
    st.subheader("Column profile")
    st.dataframe(profile, use_container_width=True, hide_index=True)


def _render_datasets(
    datasets: list[Dataset], inventory: pd.DataFrame, selected: Dataset, profile: pd.DataFrame, search: str
) -> None:
    st.caption("Uploaded files are held for this local session and are not added to the repository.")
    st.dataframe(_filter_inventory(inventory, search), use_container_width=True, hide_index=True)
    st.subheader(selected.dataset_id)
    st.dataframe(profile, use_container_width=True, hide_index=True)
    with st.container(border=True):
        st.subheader("Data preview")
        preview, excluded_columns = without_sensitive_columns(selected.dataframe.head(100))
        if excluded_columns:
            st.caption("Direct-identifier fields are hidden from previews: " + ", ".join(excluded_columns))
        st.dataframe(preview, use_container_width=True, hide_index=True)


def _render_quality(findings: list) -> None:
    st.caption("Missing values are observations unless a project rule marks them as required.")
    finding_rows = [finding.to_record() for finding in findings]
    if not finding_rows:
        st.success("No findings from the checks currently configured.")
        return

    quality = pd.DataFrame(finding_rows)
    failed = int((quality["status"] == "FAIL").sum())
    observed = int((quality["status"] == "OBSERVATION").sum())
    not_evaluated = int((quality["status"] == "NOT_EVALUATED").sum())
    counts = st.columns(3)
    counts[0].metric("Failures", failed)
    counts[1].metric("Observations", observed)
    counts[2].metric("Not evaluated", not_evaluated)
    statuses = st.multiselect(
        "Show status",
        options=["FAIL", "OBSERVATION", "NOT_EVALUATED"],
        default=["FAIL", "OBSERVATION", "NOT_EVALUATED"],
    )
    st.dataframe(
        quality[quality["status"].isin(statuses)],
        use_container_width=True,
        hide_index=True,
    )


def _relationship_suggestions(datasets: list[Dataset]) -> pd.DataFrame:
    suggestions = []
    for left_index, left in enumerate(datasets):
        left_columns = {str(column).casefold(): str(column) for column in left.dataframe.columns}
        for right in datasets[left_index + 1 :]:
            right_columns = {str(column).casefold(): str(column) for column in right.dataframe.columns}
            for normalized_name in left_columns.keys() & right_columns.keys():
                suggestions.append(
                    {
                        "Dataset": left.dataset_id,
                        "Field": left_columns[normalized_name],
                        "Candidate reference": right.dataset_id,
                        "Reference field": right_columns[normalized_name],
                        "Review status": "Suggestion only",
                    }
                )
    return pd.DataFrame(
        suggestions,
        columns=["Dataset", "Field", "Candidate reference", "Reference field", "Review status"],
    )


st.sidebar.markdown("## VELOOP")
st.sidebar.caption("DATA INTELLIGENCE")
st.sidebar.markdown("---")
page = st.sidebar.radio(
    "Navigation",
    ["Overview", "Analytics", "Datasets", "Data Quality", "Relationships", "KPI Catalogue", "Reports", "Settings"],
    label_visibility="collapsed",
)
st.sidebar.markdown("---")
uploads = st.sidebar.file_uploader(
    "Add datasets",
    type=["csv", "xlsx", "xlsm"],
    accept_multiple_files=True,
)
upload_signature = tuple(
    (upload.name, hashlib.sha256(upload.getvalue()).hexdigest())
    for upload in uploads or []
)
if st.session_state.get("_audit_upload_signature") != upload_signature:
    st.session_state.pop("_audit_workbook_data", None)
    st.session_state["_audit_upload_signature"] = upload_signature
st.sidebar.caption(f"Version {__version__} · Local workspace")

datasets: list[Dataset] = []
load_errors = []
for upload in uploads or []:
    try:
        datasets.extend(load_uploaded_file(upload.name, upload.getvalue()))
    except Exception as error:
        load_errors.append(f"{upload.name}: {error}")

page_descriptions = {
    "Overview": "Key dataset indicators and current data-quality signals.",
    "Analytics": "Explore distributions in uploaded datasets.",
    "Datasets": "Inspect source files, sheets, schemas, and sample rows.",
    "Data Quality": "Review missingness, duplicate rows, and configured rule findings.",
    "Relationships": "Review suggested links between datasets before any join is approved.",
    "KPI Catalogue": "Business metric definitions and data availability.",
    "Reports": "Generate and download audit deliverables.",
    "Settings": "Project and data-classification configuration.",
}

header_left, header_right = st.columns([1.5, 1])
with header_left:
    st.title(page)
    st.caption(page_descriptions[page])
with header_right:
    st.text_input("Search datasets", key="dataset_search", placeholder="Search files and sheets...")

for load_error in load_errors:
    st.error(f"Could not read {load_error}")

if not datasets:
    st.info("Upload one or more CSV or Excel workbooks from the sidebar to populate this workspace.")
    if page in {"Relationships", "KPI Catalogue", "Settings"}:
        st.caption("This area will become available as datasets and project configuration are added.")
    st.stop()

inventory = _inventory(datasets)
dataset_ids = [dataset.dataset_id for dataset in datasets]
selected_id = st.sidebar.selectbox("Selected dataset", dataset_ids)
selected = next(dataset for dataset in datasets if dataset.dataset_id == selected_id)
profiles = {dataset.dataset_id: profile_dataset(dataset.dataframe) for dataset in datasets}
reference_datasets = {dataset.dataset_id: dataset.dataframe for dataset in datasets}
all_findings = [
    finding
    for dataset in datasets
    for finding in run_quality_checks(
        dataset.dataset_id,
        dataset.dataframe,
        reference_datasets=reference_datasets,
    )
]
selected_findings = [finding for finding in all_findings if finding.dataset_id == selected.dataset_id]
search_query = st.session_state.get("dataset_search", "")

if page == "Overview":
    _render_overview(
        datasets,
        inventory,
        selected,
        profiles[selected.dataset_id],
        profiles,
        all_findings,
        search_query,
    )
elif page == "Analytics":
    _render_analytics(selected, profiles[selected.dataset_id])
elif page == "Datasets":
    _render_datasets(datasets, inventory, selected, profiles[selected.dataset_id], search_query)
elif page == "Data Quality":
    _render_quality(selected_findings)
elif page == "Relationships":
    suggestions = _relationship_suggestions(datasets)
    st.caption("Suggestions are based on matching field names only. No joins are performed automatically.")
    if suggestions.empty:
        st.info("No shared field names found across the uploaded datasets.")
    else:
        st.dataframe(suggestions, use_container_width=True, hide_index=True)
elif page == "KPI Catalogue":
    st.info("No approved KPI definitions are configured yet. No business metric values are being inferred.")
    st.dataframe(
        pd.DataFrame(
            [
                {"Domain": "Users and engagement", "Availability": "Requires approved definitions"},
                {"Domain": "Tasks and conversion", "Availability": "Requires event definitions"},
                {"Domain": "Rewards and wallet", "Availability": "Requires transaction data"},
                {"Domain": "Referrals", "Availability": "Requires referral data and funnel rules"},
            ]
        ),
        use_container_width=True,
        hide_index=True,
    )
elif page == "Reports":
    st.subheader("Excel audit workbook")
    st.caption("Includes source sheets, dataset inventory, column profiles, and quality findings.")
    if st.button("Generate Excel audit workbook", type="primary"):
        with st.spinner("Generating workbook..."):
            st.session_state["_audit_workbook_data"] = build_audit_workbook(datasets)
    workbook_data = st.session_state.get("_audit_workbook_data")
    if workbook_data:
        st.download_button(
            "Download Excel audit workbook",
            data=workbook_data,
            file_name="data_audit.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    st.info("PDF and Word report generation are not available yet.")
elif page == "Settings":
    st.info("No project configuration is loaded. Company-specific schemas, rules, and report settings are not applied.")
    st.dataframe(
        pd.DataFrame(
            [
                {"Setting": "Application version", "Value": __version__},
                {"Setting": "Data storage", "Value": "In-memory for this browser session"},
                {"Setting": "Project rules", "Value": "Not configured"},
            ]
        ),
        use_container_width=True,
        hide_index=True,
    )