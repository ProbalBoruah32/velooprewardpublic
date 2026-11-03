import pandas as pd

from veloop_data_intelligence.quality import (
    ConditionalRequiredRule,
    DatasetQualityConfig,
    ForeignKeyRule,
    run_quality_checks,
)


def test_missing_values_are_observations_unless_configured_as_required():
    dataframe = pd.DataFrame({"name": [None, "Ada"]})
    findings = run_quality_checks(
        "people",
        dataframe,
        DatasetQualityConfig(required_columns=("name",)),
    )

    missing_observation = next(item for item in findings if item.code == "missing_values")
    required_failure = next(item for item in findings if item.code == "required_values_missing")
    assert missing_observation.status == "OBSERVATION"
    assert required_failure.status == "FAIL"
    assert required_failure.row_numbers == (1,)


def test_detects_duplicate_rows_and_primary_keys():
    dataframe = pd.DataFrame({"id": [1, 1, 2], "kind": ["a", "a", "b"]})
    findings = run_quality_checks(
        "events",
        dataframe,
        DatasetQualityConfig(primary_key="id"),
    )

    duplicate_rows = next(item for item in findings if item.code == "duplicate_rows")
    duplicate_key = next(item for item in findings if item.code == "duplicate_primary_key")
    assert duplicate_rows.affected_rows == 2
    assert duplicate_key.severity == "CRITICAL"
    assert duplicate_key.row_numbers == (1, 2)


def test_checks_types_conditional_requirements_and_foreign_keys():
    dataframe = pd.DataFrame(
        {
            "customer_id": [1, 9, None],
            "referred": [True, False, True],
            "referral_detail": [None, None, "campaign"],
            "age": ["28", "unknown", "35"],
        }
    )
    customers = pd.DataFrame({"id": [1, 2]})
    config = DatasetQualityConfig(
        expected_types={"age": "integer"},
        conditional_required=(
            ConditionalRequiredRule("referral_detail", "referred", True),
        ),
        foreign_keys=(ForeignKeyRule("customer_id", "customers", "id"),),
    )

    findings = run_quality_checks(
        "referrals",
        dataframe,
        config,
        {"customers": customers},
    )
    by_code = {item.code: item for item in findings}

    assert by_code["schema_type_invalid"].row_numbers == (2,)
    assert by_code["conditional_values_missing"].row_numbers == (1,)
    assert "True" not in by_code["conditional_values_missing"].message
    assert by_code["foreign_key_orphan"].row_numbers == (2,)
    assert by_code["foreign_key_null"].status == "OBSERVATION"


def test_marks_foreign_key_check_not_evaluated_without_reference_data():
    findings = run_quality_checks(
        "events",
        pd.DataFrame({"user_id": [1]}),
        DatasetQualityConfig(
            foreign_keys=(ForeignKeyRule("user_id", "users", "user_id"),),
        ),
    )

    foreign_key_finding = next(item for item in findings if item.code == "foreign_key_integrity")
    assert foreign_key_finding.status == "NOT_EVALUATED"