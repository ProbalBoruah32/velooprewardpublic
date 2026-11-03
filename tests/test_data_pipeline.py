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