from io import BytesIO

import pandas as pd
from openpyxl import load_workbook

from veloop_data_intelligence.exporting import build_audit_workbook
from veloop_data_intelligence.ingestion import load_uploaded_file
from veloop_data_intelligence.profiling import profile_dataset


def test_loads_csv_and_all_excel_sheets_and_builds_audit_workbook():
    csv_content = b"user_id,active\n1,true\n2,\n"
    csv_dataset = load_uploaded_file("users.csv", csv_content)[0]
    assert csv_dataset.dataframe.shape == (2, 2)

    excel_content = BytesIO()
    with pd.ExcelWriter(excel_content, engine="openpyxl") as writer:
        pd.DataFrame({"event_id": [1, 2]}).to_excel(writer, sheet_name="Events", index=False)
        pd.DataFrame({"task_id": [3]}).to_excel(writer, sheet_name="Tasks", index=False)

    excel_datasets = load_uploaded_file("activity.xlsx", excel_content.getvalue())
    assert [dataset.sheet_name for dataset in excel_datasets] == ["Events", "Tasks"]

    profile = profile_dataset(pd.DataFrame({"score": [1, None, 5]}))
    assert profile.loc[0, "missing_count"] == 1
    assert profile.loc[0, "unique_count"] == 2
    assert profile.loc[0, "numeric_min"] == 1
    assert profile.loc[0, "numeric_median"] == 3
    assert profile.loc[0, "numeric_max"] == 5

    workbook_bytes = build_audit_workbook([csv_dataset, *excel_datasets])
    workbook = load_workbook(BytesIO(workbook_bytes), read_only=True)
    assert workbook.sheetnames[:2] == ["users.csv", "activity.xlsx _ Events"]
    assert "Inventory" in workbook.sheetnames
    assert "Column Profile" in workbook.sheetnames
    assert "Quality Findings" in workbook.sheetnames


def test_audit_workbook_neutralizes_formula_like_source_text():
    dataset = load_uploaded_file("formulas.csv", b"value\n=1+1\n")[0]
    workbook = load_workbook(BytesIO(build_audit_workbook([dataset])), read_only=True)

    assert workbook["formulas.csv"]["A2"].value == "'=1+1"


def test_audit_workbook_excludes_direct_identifiers_and_records_privacy_notes():
    dataset = load_uploaded_file(
        "people.csv",
        b"full_name,email,feature_name\nAda Lovelace,ada@example.com,tasks\n",
    )[0]
    profile = profile_dataset(dataset.dataframe)
    workbook = load_workbook(BytesIO(build_audit_workbook([dataset])), read_only=True)
    exported_columns = [cell.value for cell in workbook["people.csv"][1]]
    privacy_notes = list(workbook["Privacy Notes"].iter_rows(values_only=True))
    exported_values = [
        cell.value
        for sheet in workbook.worksheets
        for row in sheet.iter_rows()
        for cell in row
    ]

    assert exported_columns == ["feature_name"]
    assert profile.loc[profile["column"] == "email", "top_values"].item() == ""
    assert profile.loc[profile["column"] == "email", "sensitive"].item()
    assert {row[1] for row in privacy_notes[1:]} == {"full_name", "email"}
    assert "ada@example.com" not in exported_values
    assert "Ada Lovelace" not in exported_values