from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

from veloop_data_intelligence.ingestion import Dataset, load_uploaded_file
from veloop_data_intelligence.privacy import is_sensitive_column


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "projects" / "velooptask01.json"
OUTPUT_DIR = ROOT / "deliverables" / "reports"


def _read_datasets() -> list[Dataset]:
    datasets = []
    for path in sorted(ROOT.glob("*.xlsx")):
        datasets.extend(load_uploaded_file(path.name, path.read_bytes()))
    return datasets


def _format_workbook(path: Path) -> None:
    workbook = load_workbook(path)
    header_fill = PatternFill("solid", fgColor="173C3A")
    for sheet in workbook.worksheets:
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        for cell in sheet[1]:
            cell.font = Font(color="FFFFFF", bold=True)
            cell.fill = header_fill
            cell.alignment = Alignment(vertical="top", wrap_text=True)
        for column_cells in sheet.columns:
            longest = max((len(str(cell.value or "")) for cell in column_cells[:100]), default=10)
            sheet.column_dimensions[column_cells[0].column_letter].width = min(max(longest + 2, 12), 48)
    workbook.save(path)


def _write(path: Path, readme: pd.DataFrame, tables: dict[str, pd.DataFrame]) -> None:
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        readme.to_excel(writer, sheet_name="Read Me", index=False)
        for sheet_name, dataframe in tables.items():
            dataframe.to_excel(writer, sheet_name=sheet_name[:31], index=False)
    _format_workbook(path)


def _readme(title: str, limitation: str) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"item": "Deliverable", "value": title},
            {"item": "Project", "value": "VELOOP Rewards Task 01"},
            {"item": "Classification", "value": "SIMULATED / PROPOSED"},
            {"item": "Generated at (UTC)", "value": datetime.now(timezone.utc).isoformat()},
            {"item": "Integrity", "value": "No simulated result is a claim about actual VELOOP performance."},
            {"item": "Limitation", "value": limitation},
        ]
    )


def _coverage_matrix(datasets: list[Dataset]) -> pd.DataFrame:
    data_names = {dataset.sheet_name for dataset in datasets}
    coverage = [
        ("User accounts", "Registration and account state", "01_Users_1000; Users_1000_Clean; Users_Messy_Audit", "user_id; registration_datetime; account_status", "Simulated fields available", "Production event implementation unknown; direct identifiers must be minimized", "High"),
        ("Authentication", "Login and logout activity", "02_Sessions", "session_id; user_id; session_start; session_end", "Partial simulated proxy", "No explicit login/logout event contract confirmed", "High"),
        ("Onboarding", "Onboarding lifecycle", "01_Users_1000; Users_Messy_Audit", "onboarding_status", "Partial simulated field", "No onboarding start/completion timestamps or milestone contract verified", "High"),
        ("Task activity", "Task viewed, started, completed, failed", "05_Task_Activity", "activity_id; task_id; task_status; task_viewed_at; task_started_at; task_completed_at", "Simulated activity available", "Validation status and reward ledger linkage require confirmation", "High"),
        ("Feature engagement", "Feature event lifecycle", "03_Feature_Events; 07_Feature_Usage", "event_id; event_datetime; feature_name; event_name; event_status; user_id; session_id", "Simulated events available", "Production instrumentation and canonical event definitions unknown", "Critical"),
        ("Daily engagement", "Daily activity and active flags", "04_Daily_Activity", "user_id; activity_date; session_count; event_count; active_flag", "Simulated daily data available", "Active-user qualification and timezone must be approved", "High"),
        ("Rewards", "Pending, credited, reversed reward transactions", "04_Daily_Activity; 03_Feature_Events", "reward_activity_count; daily_reward_claimed; reward_related_flag", "Partial simulated proxies", "No standalone reward ledger, transaction IDs, units, or reversals supplied", "Critical"),
        ("Wallet", "Wallet credits, redemptions, adjustments, reversals", "04_Daily_Activity", "wallet_activity flag only", "Insufficient proxy", "No wallet transaction ledger, amount, unit, status, or reference IDs supplied", "Critical"),
        ("Withdrawals", "Requested through final withdrawal state", "None", "None", "Not supplied", "No request IDs, timestamps, methods, statuses, amounts, or final outcomes supplied", "Critical"),
        ("Referrals", "Created, registered, activated, converted", "01_Users_1000; Users_Messy_Audit", "referral_code; referral_source_detail; acquisition_source", "Partial user attributes", "No referral ID, inviter/invitee link, lifecycle timestamps, or conversion criteria supplied", "High"),
        ("Milestones", "Milestone and progression events", "06_Milestones", "user_id; milestone_type; milestone_datetime; milestone_value", "Simulated events available", "Production definitions and milestone catalogue need approval", "Medium"),
        ("Support and content", "Support tickets and help-content engagement", "None", "None", "Not supplied", "No ticket, issue-category, article-view, or helpfulness events supplied", "Medium"),
    ]
    rows = []
    for area, feature, sheet_names, fields, status, gap, priority in coverage:
        present = [name for name in sheet_names.split("; ") if name in data_names]
        rows.append(
            {
                "product_area": area,
                "feature_or_lifecycle": feature,
                "available_simulated_sheets": "; ".join(present) if present else "None",
                "observed_fields_or_proxy": fields,
                "coverage_status": status,
                "user_action": "To be verified with product; proposed actions are specified in the event catalogue.",
                "system_action_or_outcome": "To be verified; do not infer production behavior from simulated records.",
                "proposed_event": "See D08 Event Tracking Plan.xlsx",
                "business_question": f"Can {feature.casefold()} be measured consistently and linked to a user or transaction?",
                "gap_or_limitation": gap,
                "priority": priority,
                "status": "SIMULATED EVIDENCE" if present else "NOT SUPPLIED / TO BE VERIFIED",
            }
        )
    return pd.DataFrame(rows)


def _type_name(series: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(series):
        return "Boolean"
    if pd.api.types.is_integer_dtype(series):
        return "Integer"
    if pd.api.types.is_float_dtype(series):
        return "Decimal"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "Datetime"
    name = str(series.name).casefold()
    if "date" in name or "time" in name:
        return "Datetime or date; source format to verify"
    return "String/category; domain to verify"


def _data_dictionary(datasets: list[Dataset], config: dict[str, Any]) -> pd.DataFrame:
    provided: dict[str, dict[str, Any]] = {}
    dictionary_sheets = {
        ("VELOOP_Simulated_User_Behavior_1000.xlsx", "08_Data_Dictionary"),
        ("VELoop_Rewards_Data_01.xlsx", "Data_Dictionary"),
    }
    for filename, sheet_name in dictionary_sheets:
        path = ROOT / filename
        if not path.exists():
            continue
        dictionary = pd.read_excel(path, sheet_name=sheet_name)
        for _, row in dictionary.iterrows():
            field_name = str(row.get("field_name", ""))
            if field_name and field_name != "nan":
                provided.setdefault(field_name, row.to_dict())

    configured = config["datasets"]
    rows = []
    for dataset in datasets:
        settings = configured.get(dataset.dataset_id, {})
        required = set(settings.get("required_columns", []))
        primary_key = settings.get("primary_key")
        if isinstance(primary_key, str):
            primary_key = [primary_key]
        required.update(primary_key or [])
        for column in dataset.dataframe.columns:
            source_definition = provided.get(str(column), {})
            source_definition_value = source_definition.get("definition", "")
            definition = (
                str(source_definition_value)
                if pd.notna(source_definition_value) and str(source_definition_value).strip()
                else f"Observed in the supplied simulated {settings.get('entity', 'source')} sheet; exact business meaning requires owner verification."
            )
            sensitive = is_sensitive_column(column)
            dtype = str(source_definition.get("data_type", ""))
            if not dtype or dtype == "nan":
                dtype = _type_name(dataset.dataframe[column])
            rows.append(
                {
                    "entity": settings.get("entity", dataset.sheet_name or "source_sheet"),
                    "field_name": str(column),
                    "data_type": dtype,
                    "definition": definition,
                    "example_format": "Withheld — direct identifier" if sensitive else f"<{dtype.lower()} example; no source value copied>",
                    "required": "Yes in this project profile" if str(column) in required else "To be verified",
                    "allowed_values": "Not approved; confirm with source owner",
                    "validation": "Non-null" if str(column) in required else "Type, format, and domain rules require review",
                    "source": f"{dataset.source_name} / {dataset.sheet_name or 'CSV'}",
                    "sensitivity": "PROPOSED: Restricted" if sensitive else "PROPOSED: Internal",
                    "analytical_use": "Potential analytical use; confirm definition and necessity before production use.",
                    "status": "SIMULATED SOURCE DEFINITION" if source_definition else "OBSERVED FIELD / DEFINITION TO BE VERIFIED",
                }
            )

    proposed_fields = {
        "rewards": [
            ("reward_transaction_id", "String", "Unique reward-ledger transaction identifier."),
            ("user_id", "String", "User receiving or associated with the reward."),
            ("reward_source", "String/category", "Approved product feature or business source of the reward."),
            ("reward_status", "String/category", "Lifecycle state such as pending, credited, reversed, or corrected; values require approval."),
            ("reward_amount", "Decimal", "Reward quantity recorded by the ledger."),
            ("reward_unit", "String/category", "Approved unit such as XP, Gems, Tokens, or VEs; definitions require product approval."),
            ("created_at", "Datetime", "Timestamp the reward transaction was created."),
            ("credited_at", "Datetime", "Timestamp the reward was actually credited, if applicable."),
            ("reversal_of_transaction_id", "String", "Original transaction identifier for a reversal or correction."),
        ],
        "wallet_transactions": [
            ("wallet_transaction_id", "String", "Unique wallet ledger transaction identifier."),
            ("user_id", "String", "Wallet owner identifier."),
            ("transaction_type", "String/category", "Approved credit, redemption, reversal, or adjustment type."),
            ("amount", "Decimal", "Transaction quantity using an explicitly defined sign convention."),
            ("unit", "String/category", "Currency or reward unit for the transaction."),
            ("status", "String/category", "Transaction lifecycle status from an approved vocabulary."),
            ("source", "String/category", "Feature or system creating the transaction."),
            ("reference_id", "String", "Related task, reward, withdrawal, or source-event identifier."),
            ("occurred_at", "Datetime", "Business event time for the transaction."),
            ("reversal_of_transaction_id", "String", "Original transaction identifier when reversing or correcting."),
        ],
        "withdrawals": [
            ("withdrawal_id", "String", "Unique withdrawal request identifier."),
            ("user_id", "String", "User requesting the withdrawal."),
            ("requested_amount", "Decimal", "Requested quantity before final settlement."),
            ("unit", "String/category", "Currency or reward unit requested."),
            ("payout_method", "String/category", "Approved payout method category; no credentials stored in analytics."),
            ("requested_at", "Datetime", "Time the withdrawal was requested."),
            ("processing_at", "Datetime", "Time processing began, when applicable."),
            ("finalized_at", "Datetime", "Time of a terminal outcome, when applicable."),
            ("status", "String/category", "Approved withdrawal lifecycle state."),
            ("reason_category", "String/category", "Non-sensitive reason category for rejection or failure."),
        ],
        "referrals": [
            ("referral_id", "String", "Unique referral relationship or invitation identifier."),
            ("referring_user_id", "String", "Identifier of the user who created the referral."),
            ("referred_user_id", "String", "Identifier of the referred user after registration, where permitted."),
            ("created_at", "Datetime", "Time the invitation or referral was created."),
            ("registered_at", "Datetime", "Time the referred user registered, when verified."),
            ("activated_at", "Datetime", "Time approved activation criteria were met."),
            ("converted_at", "Datetime", "Time approved referral-conversion criteria were met."),
            ("status", "String/category", "Referral lifecycle state from an approved vocabulary."),
        ],
    }
    for entity, fields in proposed_fields.items():
        for name, dtype, definition in fields:
            rows.append(
                {
                    "entity": entity,
                    "field_name": name,
                    "data_type": dtype,
                    "definition": definition,
                    "example_format": f"<{dtype.lower()}; proposed field>",
                    "required": "Proposed; confirm with product and engineering",
                    "allowed_values": "To be defined and approved",
                    "validation": "Proposed; define with source-system owner",
                    "source": "PROPOSED — no corresponding source sheet supplied",
                    "sensitivity": "PROPOSED: Internal; review before implementation",
                    "analytical_use": "Supports proposed lifecycle and KPI analysis; implementation not verified.",
                    "status": "PROPOSED / NOT PRESENT IN SUPPLIED WORKBOOKS",
                }
            )
    return pd.DataFrame(rows)


def _event_plan() -> pd.DataFrame:
    event_specs = [
        ("user_registered", "Account", "Registration is accepted by the account service.", "A new account registration outcome.", "backend", "Registration and activation funnel"),
        ("user_logged_in", "Account", "Authentication succeeds and a session is established.", "A successful login outcome.", "backend", "Active and returning-user analysis"),
        ("user_logged_out", "Account", "An authenticated session ends or is explicitly terminated.", "A logout or session-end outcome where applicable.", "backend", "Session lifecycle and duration"),
        ("onboarding_started", "Account", "The user begins the defined onboarding flow.", "Start of an onboarding attempt.", "frontend", "Onboarding funnel"),
        ("onboarding_completed", "Account", "The server confirms the required onboarding milestones.", "Completion of an approved onboarding flow.", "backend", "Onboarding completion rate"),
        ("task_viewed", "Task", "Task details are shown to an eligible user.", "Task discovery event.", "frontend", "Task discovery funnel"),
        ("task_opened", "Task", "The user opens a task detail or instruction view.", "Task consideration event.", "frontend", "Task view-to-start funnel"),
        ("task_started", "Task", "The task begins under its approved start criteria.", "Start of a task attempt.", "backend", "Task participation"),
        ("task_validated", "Task", "The task result passes the configured validation process.", "Validated task outcome, separate from user-reported completion.", "backend", "Validated completion rate"),
        ("task_completed", "Task", "A validated task completion is accepted exactly once.", "Successful task outcome; not proof of reward credit.", "backend", "Task completion"),
        ("task_failed", "Task", "A task attempt reaches an approved failure or abandonment state.", "Unsuccessful task outcome with approved reason category.", "backend", "Task failure and abandonment"),
        ("reward_pending", "Reward", "A reward liability is created but not yet credited.", "Pending reward ledger outcome.", "backend", "Pending reward volume; blocked until ledger exists"),
        ("reward_credited", "Reward", "The ledger confirms a reward credit.", "Actual credit outcome, distinct from task activity.", "backend", "Reward credits; blocked until ledger exists"),
        ("reward_reversed", "Reward", "A posted reward is reversed with an original transaction reference.", "Reward reversal outcome.", "backend", "Reward reversals; blocked until ledger exists"),
        ("daily_reward_claimed", "Engagement", "A daily reward claim is accepted by the system.", "Daily claim outcome; separate from wallet credit.", "backend", "Daily reward claim participation"),
        ("streak_updated", "Engagement", "The streak service records an approved streak state change.", "Streak state change with prior/new values if approved.", "backend", "Streak participation"),
        ("mission_started", "Engagement", "A user starts an eligible mission.", "Mission participation start.", "backend", "Mission starts"),
        ("mission_completed", "Engagement", "The mission service confirms completion.", "Mission completion outcome.", "backend", "Mission completion"),
        ("badge_earned", "Engagement", "The badge service grants a badge.", "Badge grant outcome.", "backend", "Badge attainment"),
        ("spin_started", "Engagement", "A spin is accepted and begins.", "Spin attempt start.", "backend", "Spin starts"),
        ("spin_completed", "Engagement", "The spin result is finalized.", "Spin outcome, separately linked to any reward transaction.", "backend", "Spin completions"),
        ("referral_created", "Referral", "A referral invitation is created.", "Referral creation, not registration or conversion.", "backend", "Referral funnel top-of-funnel"),
        ("referral_registered", "Referral", "An invitee registers and is linked under approved attribution rules.", "Referral registration outcome.", "backend", "Referral registrations"),
        ("referral_activated", "Referral", "An invitee satisfies product-approved activation criteria.", "Referral activation outcome.", "backend", "Referral activation"),
        ("referral_converted", "Referral", "Approved conversion criteria are met and recorded.", "Referral conversion; not assumed from registration alone.", "backend", "Referral conversion"),
        ("wallet_transaction_created", "Wallet", "A wallet ledger transaction is created.", "Transaction creation, distinct from final completion.", "backend", "Wallet transaction volume; blocked until ledger exists"),
        ("wallet_transaction_completed", "Wallet", "A wallet ledger transaction reaches an approved completed state.", "Completed wallet transaction outcome.", "backend", "Wallet completion; blocked until ledger exists"),
        ("wallet_transaction_reversed", "Wallet", "A posted transaction is reversed with a reference to its original.", "Wallet reversal outcome.", "backend", "Wallet reversals; blocked until ledger exists"),
        ("withdrawal_requested", "Withdrawal", "A withdrawal request is accepted for review.", "Withdrawal request creation.", "backend", "Withdrawal request volume; blocked until data exists"),
        ("withdrawal_processing", "Withdrawal", "An accepted request enters processing.", "Withdrawal processing transition.", "backend", "Queue and processing time; blocked until data exists"),
        ("withdrawal_completed", "Withdrawal", "A payout provider or ledger confirms final settlement.", "Completed withdrawal outcome.", "backend", "Completion rate; blocked until data exists"),
        ("withdrawal_rejected", "Withdrawal", "A request reaches a final rejected state.", "Rejected withdrawal outcome with non-sensitive reason category.", "backend", "Rejection rate; blocked until data exists"),
        ("withdrawal_reversed", "Withdrawal", "A completed withdrawal is reversed or returned.", "Reversal outcome linked to original withdrawal.", "backend", "Reversal rate; blocked until data exists"),
    ]
    rows = []
    for index, (name, family, trigger, definition, source, purpose) in enumerate(event_specs, start=1):
        props = ["event_id:string", "occurred_at:datetime with timezone", "event_name:string", "source:string"]
        if family != "Account" or name != "user_registered":
            props.append("user_id:string")
        if family in {"Task", "Reward", "Engagement", "Referral", "Wallet", "Withdrawal"}:
            props.append("feature:string or approved domain identifier")
        if family not in {"Account"}:
            props.append("status:string from approved domain where applicable")
        if family in {"Task", "Engagement", "Reward"}:
            props.append("session_id:string when session-attributable")
        if family in {"Task", "Reward"}:
            props.append("task_id:string when task-attributable")
        if family in {"Reward", "Wallet", "Withdrawal"}:
            props.extend(["transaction_id:string where a ledger transaction exists", "unit:string where a quantity is recorded"])
        rows.append(
            {
                "requirement_id": f"EVT-{index:03d}",
                "event_name": name,
                "naming_convention": "domain_object_action; snake_case",
                "event_family": family,
                "trigger": trigger,
                "definition": definition,
                "actor_type": "System outcome" if family in {"Reward", "Wallet", "Withdrawal"} or name in {"task_validated", "task_completed", "task_failed", "onboarding_completed", "mission_completed", "badge_earned", "referral_registered", "referral_activated", "referral_converted"} else "User action / interaction",
                "required_properties": "; ".join(props),
                "optional_properties": "session_id; correlation_id; source_context; non-sensitive reason_category where applicable",
                "data_types_and_validation": "Validate identifiers, UTC/offset-aware event time, approved status/domain, and non-negative sequence; reject or quarantine malformed payloads.",
                "deduplication": "Stable event_id; idempotent backend write; define uniqueness scope before implementation.",
                "source": source,
                "business_purpose": purpose,
                "kpi_dependency": purpose,
                "acceptance_test": f"A valid {name} emits one idempotent event with required fields; invalid payloads are rejected or quarantined and observable.",
                "priority": "High" if family in {"Account", "Task", "Reward", "Wallet", "Withdrawal", "Referral"} else "Medium",
                "implementation_status": "PROPOSED — production implementation not verified",
                "evidence_note": "Specification only; supplied workbook event labels are simulated evidence, not proof this event exists in production.",
            }
        )
    return pd.DataFrame(rows)


def _kpi_catalogue() -> pd.DataFrame:
    definitions = [
        ("Registrations", "Users", "Count of accepted account registrations in the period.", "Count distinct user_id where user_registered occurred in period.", "user_id; occurred_at; registration status", "User event stream", "SIMULATED STRUCTURE ONLY"),
        ("Verified Registrations", "Users", "Registrations reaching the approved verification state.", "Count distinct registered user_id with verification_status=verified / registrations.", "user_id; verification_status; verified_at", "User/account event stream", "BLOCKED: verified_at not supplied"),
        ("Onboarding Completion Rate", "Users", "Share of onboarding starts that reach approved completion.", "Distinct users with onboarding_completed / distinct users with onboarding_started.", "user_id; event_name; occurred_at", "Onboarding event stream", "BLOCKED: start/completion events not supplied"),
        ("Daily Active Users", "Users", "Unique users with a qualifying activity on a calendar day.", "Count distinct user_id with an approved qualifying event or active_flag=true per day.", "user_id; activity/event time; qualifying action", "Daily activity or event stream", "SIMULATED STRUCTURE ONLY; activity rule/timezone require approval"),
        ("Weekly Active Users", "Users", "Unique users with a qualifying activity in a defined seven-day window.", "Count distinct user_id with qualifying activity in trailing or calendar week; choose one convention.", "user_id; activity/event time; qualifying action", "Daily activity or event stream", "SIMULATED STRUCTURE ONLY; week and activity rules require approval"),
        ("Monthly Active Users", "Users", "Unique users with a qualifying activity in a defined month.", "Count distinct user_id with qualifying activity in calendar month.", "user_id; activity/event time; qualifying action", "Daily activity or event stream", "SIMULATED STRUCTURE ONLY; activity rules require approval"),
        ("New Users", "Users", "Users whose registration falls within the reporting period.", "Count distinct user_id by registration_datetime in period.", "user_id; registration_datetime", "User account data", "SIMULATED STRUCTURE ONLY"),
        ("Returning Active Users", "Users", "Active users with qualifying activity before the current reporting period.", "Count distinct active user_id with prior-period qualifying activity.", "user_id; event/activity time", "Longitudinal event data", "SIMULATED STRUCTURE ONLY; history window must be approved"),
        ("Inactive Users", "Users", "Eligible users with no qualifying activity during an approved lookback window.", "Eligible registered users minus active users in lookback window.", "user_id; account status; activity time", "Users and event/activity data", "Definition/lookback and eligibility require approval"),
        ("User Growth Rate", "Users", "Relative change in registered-user count between comparable periods.", "(registrations current period - prior period) / prior period registrations.", "user_id; registration_datetime", "User account data", "Requires comparable periods; undefined when prior denominator is zero"),
        ("Average Sessions per Active User", "Engagement", "Average session count among qualifying active users.", "Count sessions / distinct active users for the same period.", "session_id; user_id; session_start", "Sessions and activity", "SIMULATED STRUCTURE ONLY; session rules require approval"),
        ("Average Session Duration", "Engagement", "Mean elapsed duration of valid completed sessions.", "Mean(session_end - session_start) for valid sessions.", "session_id; session_start; session_end", "Session events", "SIMULATED STRUCTURE ONLY; censor open sessions and timezone rules"),
        ("Feature Adoption Rate", "Engagement", "Share of eligible users using a feature in the period.", "Distinct users with qualifying feature event / eligible users.", "user_id; feature_name; event_datetime; eligibility", "Feature events and eligible user base", "Eligibility denominator and qualifying event require approval"),
        ("Feature Events per Active User", "Engagement", "Average qualifying feature events among active users.", "Qualifying feature event count / distinct active users.", "event_id; user_id; feature_name; event_status", "Feature events", "SIMULATED STRUCTURE ONLY; event taxonomy/status require approval"),
        ("Task Starts", "Tasks", "Distinct task attempts that reach approved started state.", "Count distinct activity_id where task_started_at is valid.", "activity_id; user_id; task_id; task_started_at", "Task activity", "SIMULATED STRUCTURE ONLY"),
        ("Validated Task Completions", "Tasks", "Task attempts whose result passes the approved validation process.", "Count distinct activity_id with validation_status=passed.", "activity_id; task_id; validation_status; completed_at", "Task and validation events", "BLOCKED: validation_status not supplied"),
        ("Task Completion Rate", "Tasks", "Share of started task attempts reaching validated completion.", "Validated completed attempts / started attempts.", "activity_id; task_status; validation status", "Task activity", "Status taxonomy and denominator require approval"),
        ("Task Failure Rate", "Tasks", "Share of started task attempts ending in an approved failure state.", "Failed attempts / started attempts.", "activity_id; task_status; failure_reason", "Task activity", "Failure taxonomy requires approval"),
        ("Repeat Task Participation", "Tasks", "Users with more than one task start in the period.", "Count users with >1 distinct task attempt / users with >=1 attempt.", "user_id; activity_id; task_started_at", "Task activity", "SIMULATED STRUCTURE ONLY"),
        ("Mission Completion Rate", "Engagement", "Share of started missions reaching approved completion.", "Distinct completed mission_id / distinct started mission_id.", "user_id; mission_id; status; timestamps", "Mission events", "BLOCKED: mission lifecycle records not supplied"),
        ("Daily Reward Claim Rate", "Rewards", "Share of eligible users with an accepted daily reward claim.", "Distinct claimants / eligible users.", "user_id; claim_id; claimed_at; eligibility", "Daily reward ledger/events", "Claim proxy exists only in simulated daily activity; approval required"),
        ("Streak Participation", "Engagement", "Users recording an approved streak activity in period.", "Count distinct user_id with streak_updated.", "user_id; streak_id; occurred_at", "Streak event stream", "BLOCKED: streak event details not supplied"),
        ("Reward Credits", "Rewards", "Count of ledger-confirmed reward credit transactions.", "Count distinct reward_transaction_id where status=credited.", "reward_transaction_id; amount; unit; status; credited_at", "Reward ledger", "BLOCKED: no reward ledger supplied"),
        ("Pending Rewards", "Rewards", "Count or quantity of reward transactions pending credit at period end.", "Count/sum transactions with pending status at snapshot time.", "reward_transaction_id; amount; unit; status; created_at", "Reward ledger", "BLOCKED: no reward ledger supplied"),
        ("Reward Reversals", "Rewards", "Count of ledger-confirmed reward reversals.", "Count distinct reversal transaction IDs linked to original credit.", "transaction_id; reversal_of_transaction_id; status", "Reward ledger", "BLOCKED: no reward ledger supplied"),
        ("Reward Credit Rate", "Rewards", "Share of eligible validated activities resulting in a confirmed credit.", "Count credited source activities / count eligible validated activities.", "source_activity_id; validation status; reward transaction status", "Task and reward ledgers", "BLOCKED: no reward ledger or confirmed linkage"),
        ("Reward Quantity by Feature", "Rewards", "Credited reward quantity grouped by approved source feature and unit.", "Sum(amount) by feature and unit for credited transactions.", "amount; unit; source_feature; status; credited_at", "Reward ledger", "BLOCKED: no reward ledger or approved units"),
        ("Wallet Transaction Count", "Wallet", "Count of unique wallet ledger transactions by type and status.", "Count distinct wallet_transaction_id.", "wallet_transaction_id; type; status; occurred_at", "Wallet ledger", "BLOCKED: no wallet ledger supplied"),
        ("Wallet Credit Volume", "Wallet", "Total confirmed positive wallet credits in a defined unit.", "Sum(amount) for completed credit transactions, grouped by unit.", "transaction_id; amount; unit; type; status", "Wallet ledger", "BLOCKED: no wallet ledger or sign convention"),
        ("Wallet Redemption Volume", "Wallet", "Total completed wallet redemptions in a defined unit.", "Sum(amount) for completed redemption transactions by unit.", "transaction_id; amount; unit; type; status", "Wallet ledger", "BLOCKED: no wallet ledger or redemption definition"),
        ("Wallet Reversal Volume", "Wallet", "Total reversed wallet quantity linked to original transactions.", "Sum(reversal amount) by unit and original transaction.", "transaction_id; reversal_of_transaction_id; amount; unit", "Wallet ledger", "BLOCKED: no wallet ledger"),
        ("Net Wallet Movement", "Wallet", "Net ledger movement under an approved sign convention.", "Credits - debits + adjustments, grouped by unit and period.", "transaction_type; amount; unit; status", "Wallet ledger", "BLOCKED: no wallet ledger or signed convention"),
        ("Withdrawal Requests", "Withdrawals", "Count of accepted withdrawal requests.", "Count distinct withdrawal_id by requested_at.", "withdrawal_id; user_id; requested_at; amount", "Withdrawal service/ledger", "BLOCKED: no withdrawal records supplied"),
        ("Withdrawal Completion Rate", "Withdrawals", "Share of requests reaching confirmed settlement.", "Completed withdrawal IDs / eligible requested withdrawal IDs.", "withdrawal_id; status; finalized_at", "Withdrawal service/ledger", "BLOCKED: no withdrawal records or terminal-state rules"),
        ("Pending Withdrawal Queue", "Withdrawals", "Open withdrawal requests at a defined as-of time.", "Count requests whose latest status is non-terminal at snapshot time.", "withdrawal_id; status history; timestamps", "Withdrawal status history", "BLOCKED: no withdrawal records or status history"),
        ("Average Withdrawal Processing Time", "Withdrawals", "Mean elapsed time from request to confirmed terminal outcome.", "Mean(finalized_at - requested_at) for eligible completed requests.", "withdrawal_id; requested_at; finalized_at; status", "Withdrawal service/ledger", "BLOCKED: no withdrawal timestamps or completion criteria"),
        ("Withdrawal Rejection Rate", "Withdrawals", "Share of withdrawal requests reaching rejected terminal state.", "Rejected request IDs / eligible requested IDs.", "withdrawal_id; status; requested_at", "Withdrawal service/ledger", "BLOCKED: no withdrawal records or approved status list"),
        ("Referral Invitations", "Referrals", "Count of unique referral invitations created.", "Count distinct referral_id by created_at.", "referral_id; referring_user_id; created_at", "Referral service", "BLOCKED: no referral event dataset supplied"),
        ("Referral Registration Rate", "Referrals", "Share of created referrals that lead to a linked registration.", "Distinct linked referral registrations / created referrals.", "referral_id; referred_user_id; registered_at", "Referral service and users", "BLOCKED: no referral linkage/lifecycle records"),
        ("Referral Activation Rate", "Referrals", "Share of referred registrations meeting approved activation criteria.", "Activated referred users / linked referred registrations.", "referral_id; user_id; activated_at; activation rule", "Referral and activity data", "BLOCKED: activation definition and records unavailable"),
        ("Referral Conversion Rate", "Referrals", "Share of referrals meeting approved conversion criteria.", "Converted referral IDs / eligible created referral IDs.", "referral_id; status; converted_at; conversion rule", "Referral service", "BLOCKED: conversion rule and records unavailable"),
        ("Support Request Volume", "Support", "Count of support requests by approved issue category.", "Count distinct ticket_id by created_at and issue_category.", "ticket_id; issue_category; created_at; status", "Support system", "BLOCKED: no support dataset supplied"),
    ]
    rows = []
    for name, category, definition, formula, fields, source, limitation in definitions:
        availability = "PROPOSED; BLOCKED BY SOURCE DATA" if limitation.startswith("BLOCKED") else "PROPOSED; SIMULATED STRUCTURE ONLY"
        rows.append(
            {
                "kpi_name": name,
                "category": category,
                "definition": definition,
                "formula": formula,
                "required_fields": fields,
                "data_source": source,
                "frequency": "Daily or per approved reporting cadence",
                "stakeholder": "Proposed: Product / Analytics",
                "business_purpose": f"Support analysis of {name.casefold()} without asserting a target.",
                "interpretation": "Compare only across like-for-like periods and approved definitions; report numerator and denominator.",
                "limitation": limitation,
                "status": availability,
            }
        )
    return pd.DataFrame(rows)


def _dashboard_blueprint() -> pd.DataFrame:
    views = [
        ("Executive Overview", "Qualifying active users", "Distinct users with approved activity per date", "Daily Activity / Events", "Line trend; KPI", "Date; source; platform", "Daily / weekly / monthly", "Registration and activity time", "Daily after data validation", "Is qualifying activity changing over time?", "Investigate changes in usage", "SIMULATED ONLY; activity definition pending"),
        ("Executive Overview", "Rewards / wallet / withdrawals / referrals availability", "Show source coverage state, never substitute zero for missing source", "Coverage matrix and source inventory", "Availability indicators", "Domain; dataset", "Current snapshot", "N/A", "On source refresh", "Which business areas are measurable?", "Prioritize instrumentation and data contracts", "Unavailable transaction domains shown as unavailable"),
        ("User Analytics", "Registrations", "Count users by registration date", "Users", "Time series", "Date; acquisition source; platform; geography", "Daily / weekly / monthly", "registration_datetime", "Daily after validation", "Where and when are simulated registrations recorded?", "Review acquisition coverage", "Simulated only; no production claim"),
        ("User Analytics", "Account status", "Count users by approved status", "Users", "Stacked bar", "Status; acquisition source; platform", "Current snapshot", "status change time needed", "Daily snapshot", "What account states are represented?", "Identify lifecycle instrumentation gaps", "Status vocabulary requires owner approval"),
        ("User Analytics", "Onboarding funnel", "Started users progressing to completed milestones", "Onboarding Events", "Funnel", "Platform; source; cohort", "Registration cohort", "onboarding timestamps required", "Daily", "Where do users leave onboarding?", "Prioritize onboarding improvements", "Not computable from status alone"),
        ("Engagement", "Feature adoption", "Distinct users with qualifying feature event / eligible users", "Feature Events", "Bar and trend", "Feature; platform; source", "Daily / weekly", "event_datetime", "Daily", "Which features are used?", "Guide product discovery", "Qualifying event and eligibility require approval"),
        ("Engagement", "Session duration", "Mean valid session end-start", "Sessions", "Distribution and trend", "Platform; device; entry point", "Daily / weekly", "session_start / session_end", "Daily", "How long do sessions last?", "Investigate session experience", "Exclude invalid/incomplete sessions by approved rule"),
        ("Task Analytics", "Task funnel", "Viewed to started to validated completion", "Task Activity + validation events", "Funnel", "Task category; platform; source", "Daily / weekly", "task lifecycle timestamps", "Daily", "Where do task attempts fail?", "Improve task flow and instrumentation", "Validation event currently unconfirmed"),
        ("Rewards", "Reward lifecycle", "Pending, credited, reversed, corrected ledger events", "Reward ledger", "Stacked trend", "Feature; reward unit; status", "Daily / weekly", "ledger timestamps", "Daily", "Which actions result in actual credits?", "Monitor reward operations", "Unavailable until a reward ledger exists"),
        ("Wallet", "Wallet movements", "Credits, redemptions, reversals under an approved sign convention", "Wallet ledger", "Diverging bar / trend", "Type; unit; source", "Daily / weekly", "transaction timestamp", "Daily", "How does the wallet change?", "Reconcile wallet activity", "Unavailable until a wallet ledger exists"),
        ("Withdrawals", "Withdrawal lifecycle", "Requests by status and elapsed time to terminal state", "Withdrawal service/ledger", "Funnel and aging table", "Status; method; reason category", "Daily / weekly", "requested / final timestamps", "Daily", "Where are requests delayed or rejected?", "Address operational bottlenecks", "Unavailable until withdrawal records exist"),
        ("Referrals", "Referral funnel", "Created to registered to activated to converted", "Referral service + users", "Funnel", "Source; cohort; platform", "Weekly / monthly", "referral lifecycle timestamps", "Daily", "Which stage loses referred users?", "Improve referral experience", "Unavailable without referral IDs and approved criteria"),
        ("Data Quality", "Quality findings", "Counts by severity, rule, dataset, and time", "Quality Audit", "Trend and issue table", "Dataset; severity; rule", "Current and trend", "audit run timestamp", "On every ingestion", "Which input problems block reliable reporting?", "Prioritize remediation", "Severity policy and owners need approval"),
        ("Relationships", "Key integrity", "Candidate key matches and orphan counts", "Relationship Audit", "Relationship table / ER view", "Dataset; key; reference", "Current snapshot", "source snapshot time", "On every ingestion", "Can datasets be joined safely?", "Approve or reject relationships", "User approval required before joins"),
    ]
    columns = ["dashboard", "visual_or_metric", "calculation", "source", "visualization", "filters", "dimensions", "date_range", "refresh_frequency", "business_question", "decision_supported", "availability_and_limitations"]
    return pd.DataFrame(views, columns=columns)


def _readiness() -> pd.DataFrame:
    rows = [
        ("Data provenance and classification", 2, "Supplied assignment files are explicitly simulated and are inventoried.", "No production source supplied.", "Document source type and prevent mixing environments.", "High"),
        ("User and session identity", 2, "Simulated user_id and session_id fields exist and sample joins passed.", "No production contract or ownership verified.", "Confirm stable IDs and uniqueness in production.", "Critical"),
        ("Event instrumentation", 1, "Simulated event sheets exist; proposed event catalogue is prepared.", "Production implementation is unverified.", "Engineering verification and event acceptance tests.", "Critical"),
        ("Rewards data", 0, "Only simulated reward-related proxies are present.", "No transaction ledger, IDs, units, or reversal linkage.", "Approve and implement reward ledger contract.", "Critical"),
        ("Wallet and withdrawals", 0, "No transaction datasets supplied.", "Lifecycle states and timestamps unavailable.", "Approve transaction models and instrumentation.", "Critical"),
        ("Referral measurement", 1, "Some simulated user referral attributes exist.", "No referral event lifecycle or conversion rule.", "Define referral IDs and funnel criteria.", "High"),
        ("Data dictionary and semantics", 2, "Source dictionaries exist and a richer field inventory is generated.", "Definitions, nullability, allowed values, and sensitivity need owner review.", "Approve the 75+ field dictionary.", "High"),
        ("Data quality controls", 2, "Simulated audit identifies defects; proposed control stages are documented.", "Some state-transition and production-domain rules remain unassessed.", "Review D13 rules with product and engineering.", "High"),
        ("Relationships", 2, "Ten configured simulated relationships passed with zero orphans.", "Candidate matches do not establish production constraints.", "Confirm keys and cardinality with data owners.", "High"),
        ("KPI definitions", 1, "A proposed KPI catalogue with formulas and dependencies is prepared.", "No KPI owner approval and several domains lack source data.", "Approve definitions and mark each KPI available/blocked.", "High"),
        ("Privacy and access", 1, "Direct identifiers are excluded from report previews and generated workbooks.", "Retention, production roles, consent and access controls are not supplied.", "Obtain privacy/legal decisions; do not infer retention.", "High"),
        ("Reporting and operations", 2, "Streamlit prototype and reproducible Excel audit generation work locally.", "No production scheduling, monitoring, authentication, or deployment controls.", "Define operating owner and deployment controls before production.", "Medium"),
    ]
    return pd.DataFrame(
        [
            {
                "dimension": dimension,
                "evidence_level_0_to_3": score,
                "scale": "0=unavailable; 1=proposed only; 2=simulated evidence/prototype; 3=production verified and approved",
                "evidence": evidence,
                "gap": gap,
                "next_verification_or_action": action,
                "priority": priority,
                "production_readiness": "NOT ESTABLISHED",
            }
            for dimension, score, evidence, gap, action, priority in rows
        ]
    )


def main() -> None:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    datasets = _read_datasets()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    outputs = {
        "D03_Data_Coverage_Matrix.xlsx": {"Coverage Matrix": _coverage_matrix(datasets)},
        "D08_Event_Tracking_Plan.xlsx": {"Event Catalogue": _event_plan()},
        "D09_Data_Dictionary.xlsx": {"Data Dictionary": _data_dictionary(datasets, config)},
        "D11_KPI_Catalogue.xlsx": {"KPI Catalogue": _kpi_catalogue()},
        "D14_Dashboard_Blueprint.xlsx": {"Visual Specifications": _dashboard_blueprint()},
        "D18_Analytics_Readiness.xlsx": {"Readiness Scorecard": _readiness()},
    }
    limitations = {
        "D03_Data_Coverage_Matrix.xlsx": "Sheet presence reflects simulated inputs only; production behavior remains unverified.",
        "D08_Event_Tracking_Plan.xlsx": "Events are proposed specifications and are not confirmed as implemented.",
        "D09_Data_Dictionary.xlsx": "Inferred definitions and all added transaction fields require owner review; no direct-identifier examples are copied.",
        "D11_KPI_Catalogue.xlsx": "Formulas are proposed; no company targets or simulated KPI values are included.",
        "D14_Dashboard_Blueprint.xlsx": "Blueprint only; unsupported domains must display unavailable rather than zero.",
        "D18_Analytics_Readiness.xlsx": "Evidence-level scores describe this assignment workspace, not production readiness; no single aggregate score is asserted.",
    }
    for filename, tables in outputs.items():
        path = OUTPUT_DIR / filename
        _write(path, _readme(filename.removesuffix(".xlsx"), limitations[filename]), tables)
        rows = next(iter(tables.values())).shape[0]
        print(f"{filename}: {rows} rows")


if __name__ == "__main__":
    main()