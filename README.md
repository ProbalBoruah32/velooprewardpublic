---
title: VELOOP Data Intelligence
sdk: streamlit
app_file: app.py
python_version: "3.11"
colorFrom: green
colorTo: cyan
---

# VELOOP Data Intelligence Platform

A reusable Streamlit MVP for uploading datasets, profiling their structure, reviewing quality signals, and exporting an Excel audit workbook. Company-specific schemas, KPIs, and business rules are intentionally kept out of the core engine so project configurations can be added later.

## Current scope

- Upload multiple CSV, XLSX, and XLSM files.
- Read every worksheet in each Excel workbook as a separate dataset.
- Review dataset inventory, column types, missing values, unique values, common values, and duplicate-row counts.
- Explore dataset distributions and suggested relationships based on matching field names.
- Review configured and unconfigured quality findings without treating every missing value as an error.
- Download an audit workbook containing source data, inventory, column profiles, and quality findings.
- Use Overview, Analytics, Datasets, Data Quality, Relationships, KPI Catalogue, Reports, and Settings pages.

Business KPI calculations, project-specific rule selection inside the app, PDF reports, and Word reports are not implemented yet; the corresponding pages show their current availability rather than invented results.

## Deploy the static edition to Netlify

Netlify cannot run the Python/Streamlit entry point. This repository includes a separate static edition in `netlify/` that reproduces browser-side ingestion, profiling, quality observations, relationship suggestions, and Excel audit export. Uploaded file contents are processed in the visitor's browser and are not sent to Netlify. Uploads are limited to 50 MB per file and 100 MB per browser session. Do not upload sensitive production data to a public site without your organization's approval.

To deploy from the Netlify dashboard, import this GitHub repository, select the `develop` branch, leave the build command empty, and set the publish directory to `netlify`. The included `netlify.toml` also configures the publish directory. For a CLI deployment, run `npx netlify-cli deploy --prod --dir netlify` after authenticating the Netlify CLI.

The static edition depends on SheetJS and Plotly CDN scripts for spreadsheet parsing/export and charts. Its KPI catalogue reports availability rather than calculating unapproved business metrics. PDF/Word report generation and Python quality rules remain available only in the local Streamlit edition.

## Run locally on Windows

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
streamlit run app.py
```

Open `http://localhost:8501` if the browser does not open automatically.

## Run tests

```powershell
python -m pytest
```

## VELOOP Task 01 deliverables

The assignment tracker and evidence registers are in [deliverables/README.md](deliverables/README.md). The supplied PDF and workbook data are classified as simulated; do not describe generated results as actual VELOOP performance.

From the repository root, regenerate the profiling and quality workbooks with:

```powershell
python -m deliverables.build_data_audits
```

Regenerate the coverage matrix, event plan, data dictionary, KPI catalogue, dashboard blueprint, and readiness scorecard with:

```powershell
python -m deliverables.build_specification_pack
```

Source CSV/Excel datasets are ignored by Git. Generated report workbooks are retained under `deliverables/reports/`; personal values from common direct-identifier fields are excluded.

## Project layout

```text
app.py
veloop_data_intelligence/
  ingestion.py
  profiling.py
  quality.py
  exporting.py
tests/
config/projects/
deliverables/
```

## Architecture map

| Current module | Responsibility | Target area |
| --- | --- | --- |
| `app.py` | Streamlit workflow and presentation | `modules/` |
| `veloop_data_intelligence/ingestion.py` | File reading and dataset objects | `core/ingestion.py` |
| `veloop_data_intelligence/profiling.py` | Dataset and column summaries | `core/profiling.py` |
| `veloop_data_intelligence/quality.py` | Configurable quality rules and findings | `core/quality.py`, `core/validation.py` |
| `veloop_data_intelligence/exporting.py` | Excel audit workbook generation | `generators/excel_generator.py` |
| `tests/` | Automated behavior checks | `tests/` |

The current processing package is independent of Streamlit. Modules will stay in place until their behavior is covered by tests; the target folders are a gradual destination, not a bulk-move task. Project-specific schemas, key relationships, and business rules belong in configuration and are passed into the reusable engine.