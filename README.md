# VELOOP Data Intelligence Platform

A small, reusable MVP for uploading datasets, profiling their structure, and exporting an Excel audit workbook. Company-specific schemas, KPIs, and business rules are intentionally kept out of the core engine so project configurations can be added later.

## Current scope

- Upload multiple CSV, XLSX, and XLSM files.
- Read every worksheet in each Excel workbook as a separate dataset.
- Review dataset inventory, column types, missing values, unique values, common values, and duplicate-row counts.
- Download an audit workbook containing source data, an inventory, and column profiles.

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

## Project layout

```text
app.py
veloop_data_intelligence/
  ingestion.py
  profiling.py
  exporting.py
tests/
```

The processing package is independent of Streamlit. Future project configurations can define schemas, key relationships, business rules, KPI definitions, and report settings without changing the general-purpose ingestion and profiling functions.