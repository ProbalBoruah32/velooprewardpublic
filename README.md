---
title: VELOOP Data Intelligence
sdk: streamlit
app_file: app.py
python_version: "3.11"
colorFrom: green
colorTo: cyan
---

# VELOOP Data Intelligence Platform

A reusable Streamlit MVP and browser-only Netlify edition for uploading datasets, profiling their structure, reviewing quality signals, and exploring evidence-based simulated product analytics. Supplied workbook values remain classified as simulated; unsupported financial, withdrawal, referral, and revenue metrics are explicitly marked as requiring data.

## Current scope

- Upload multiple CSV, XLSX, and XLSM files.
- Read every worksheet in each Excel workbook as a separate dataset.
- Review dataset inventory, column types, missing values, unique values, common values, and duplicate-row counts.
- Explore dataset distributions and suggested relationships based on matching field names.
- Review configured and unconfigured quality findings without treating every missing value as an error.
- Download an audit workbook containing source data, inventory, column profiles, and quality findings.
- Calculate a 35-metric KPI catalogue from actual user, session, event, daily activity, task, and milestone fields.
- Explore user, session, feature, task-funnel, cohort-retention, and milestone analytics with date filters.
- Search observed data dictionary fields; distinguish source-documented definitions from observed fields with proposed definitions.
- Validate candidate user/session relationships against source keys, including match rates, orphan rows, and duplicate reference keys.
- Export the expanded audit/KPI/dictionary/relationship workbook. The static edition can print the executive overview to PDF using the browser's Save as PDF function.
- Use Overview, Executive Overview, Product Analytics, Analytics, Datasets, Data Quality, Relationships, KPI Catalogue, Data Dictionary, Reports, and Settings.

The new product-analytics modules are in the browser-based Netlify edition; the existing local Streamlit MVP remains available for its original upload, profiling, quality, and audit workflow and has not been ported to the new product dashboard.

KPI values use the actual uploaded data and retain source, formula, availability, and limitations. Retention uses registration cohorts and exact day-N activity windows; cohorts without a fully observed window are excluded. Session/task durations exclude invalid or negative intervals. The browser edition has no server-side storage, does not alter source rows, and excludes common direct identifiers from report exports. Word exports and a native PDF generator are not included.

The supplied workbook's `events_in_session` summary disagrees with joined Feature Events for 7,537 of 7,913 sessions. The app flags this quality issue and calculates average events per session from Feature Events joined to all observed session IDs, rather than trusting the inconsistent summary field.

## Deploy the static edition to Netlify

Netlify cannot run the Python/Streamlit entry point. This repository includes a separate static edition in `netlify/` that reproduces browser-side ingestion, profiling, quality observations, relationship suggestions, and Excel audit export. Uploaded file contents are processed in the visitor's browser and are not sent to Netlify. Uploads are limited to 50 MB per file and 100 MB per browser session. Do not upload sensitive production data to a public site without your organization's approval.

To deploy from the Netlify dashboard, import this GitHub repository, select the `develop` branch, leave the build command empty, and set the publish directory to `netlify`. The included `netlify.toml` also configures the publish directory. For a CLI deployment, run `npx netlify-cli deploy --prod --dir netlify` after authenticating the Netlify CLI.

The static edition depends on SheetJS and Plotly CDN scripts for spreadsheet parsing/export and charts. It processes uploads in the browser, fingerprints workbook contents to skip exact duplicate imports, and calculates metrics only when required fields are present. The Excel audit includes actual KPI results, field definitions, data quality findings, relationships, and future data requirements. PDF output is provided through browser printing; Word report generation is not included.

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

Run the browser analytics logic tests with Node.js:

```powershell
node --test tests\test_product_analytics.js
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
netlify/
  product_analytics.js
  app.js
  index.html
  styles.css
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