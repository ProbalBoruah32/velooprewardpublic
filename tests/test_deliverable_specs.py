import pandas as pd

from deliverables.build_data_audits import _additional_findings
from deliverables.build_specification_pack import (
    _dashboard_blueprint,
    _event_plan,
    _kpi_catalogue,
    _readiness,
)
from veloop_data_intelligence.ingestion import Dataset


def test_specification_pack_meets_event_and_kpi_targets_without_claiming_implementation():
    events = _event_plan()
    kpis = _kpi_catalogue()

    assert len(events) >= 25
    assert events["event_name"].is_unique
    assert events["implementation_status"].str.startswith("PROPOSED").all()
    assert len(kpis) >= 30
    assert kpis["kpi_name"].is_unique
    assert kpis["status"].str.contains("PROPOSED").all()
    assert kpis["limitation"].str.contains("BLOCKED", case=False).any()


def test_dashboard_and_readiness_specs_are_explicit_about_evidence():
    dashboards = _dashboard_blueprint()
    readiness = _readiness()

    assert dashboards["dashboard"].nunique() >= 7
    assert dashboards["availability_and_limitations"].str.contains("Unavailable").any()
    assert len(readiness) >= 10
    assert readiness["production_readiness"].eq("NOT ESTABLISHED").all()


def test_messy_data_audit_detects_format_numeric_date_and_reference_issues():
    dataframe = pd.DataFrame(
        {
            "account_status": ["ACTIVE ", "active", "unexpected"],
            "event_datetime": ["2025-01-01", "not-a-date", "2025-01-03"],
            "daily_count": [1, -2, "many"],
        }
    )
    baseline = pd.DataFrame({"account_status": ["active", "inactive"]})
    dataset = Dataset("messy_users", "users.xlsx", "Messy", dataframe)

    findings = _additional_findings(
        dataset,
        {"status_baseline": "clean_users", "_baseline_dataframe": baseline},
    )
    issue_types = {finding["issue_type"] for finding in findings}

    assert "trailing_or_leading_whitespace" in issue_types
    assert "inconsistent_category_format" in issue_types
    assert "status_not_in_clean_reference" in issue_types
    assert "malformed_date" in issue_types
    assert "invalid_numeric_value" in issue_types
    assert "negative_nonnegative_measure" in issue_types