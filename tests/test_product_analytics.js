const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const browser = { window: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "netlify", "product_analytics.js"), "utf8"),
  browser,
);
const analytics = browser.window.VeloopProductAnalytics;

function dataset(id, sheetName, rows) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const values = rows.map((row) => columns.map((column) => row[column] ?? null));
  const profile = columns.map((column, index) => {
    const present = values.map((row) => row[index]).filter((value) => value !== null && value !== "");
    const numeric = present.map(Number).filter(Number.isFinite);
    return {
      column,
      dtype: numeric.length === present.length && present.length ? "number" : "string/category",
      missingCount: values.length - present.length,
      dateInvalid: 0,
      min: numeric.length ? Math.min(...numeric) : null,
    };
  });
  return { id, sourceName: "simulated.xlsx", sheetName, columns, rows: values, profile, duplicateRows: 0 };
}

function fixture() {
  return [
    dataset("simulated.xlsx / 01_Users_1000", "01_Users_1000", [
      { user_id: "U1", registration_datetime: "2026-01-01T12:00:00Z", verification_status: "Verified", onboarding_status: "Completed", account_status: "Active", acquisition_source: "Referral", platform: "Web", state: "CA", email: "u1@example.test" },
      { user_id: "U2", registration_datetime: "2026-01-02T12:00:00Z", verification_status: "Verified", onboarding_status: "Started", account_status: "Inactive", acquisition_source: "Organic", platform: "Web", state: "NY", email: "u2@example.test" },
      { user_id: "U3", registration_datetime: "2026-01-30T12:00:00Z", verification_status: "Pending", onboarding_status: "Not Started", account_status: "Active", acquisition_source: "Referral", platform: "Web", state: "CA", email: "u3@example.test" },
    ]),
    dataset("simulated.xlsx / 02_Sessions", "02_Sessions", [
      { session_id: "S1", user_id: "U1", session_start: "2026-01-01T10:00:00Z", session_end: "2026-01-01T10:00:40Z", session_duration_seconds: 40, events_in_session: 12, features_used_count: 2, session_status: "Completed", entry_point: "Home", exit_feature: "Wallet", platform: "Web", device: "Desktop" },
      { session_id: "S2", user_id: "U2", session_start: "2026-01-02T10:00:40Z", session_end: "2026-01-02T10:00:00Z", session_duration_seconds: -40, events_in_session: 12, features_used_count: 1, session_status: "Completed", entry_point: "Referral", exit_feature: "Tasks", platform: "Web", device: "Mobile" },
      { session_id: "S3", user_id: "U3", session_start: "2026-01-30T10:00:00Z", session_end: "2026-01-30T10:00:20Z", session_duration_seconds: 20, events_in_session: 0, features_used_count: 0, session_status: "Completed", entry_point: "Home", exit_feature: "Home", platform: "Web", device: "Desktop" },
    ]),
    dataset("simulated.xlsx / 03_Feature_Events", "03_Feature_Events", [
      { event_id: "E1", user_id: "U1", session_id: "S1", event_datetime: "2026-01-02T10:00:00Z", feature_name: "Wallet", event_status: "Success", xp_related_flag: "Yes", platform: "Web" },
      { event_id: "E2", user_id: "U2", session_id: "S2", event_datetime: "2026-01-03T10:00:00Z", feature_name: "Tasks", event_status: "Failed", xp_related_flag: "No", platform: "Web" },
    ]),
    dataset("simulated.xlsx / 04_Daily_Activity", "04_Daily_Activity", [
      { user_id: "U1", activity_date: "2026-01-02", active_flag: "Yes" },
      { user_id: "U1", activity_date: "2026-01-08", active_flag: "Yes" },
      { user_id: "U1", activity_date: "2026-01-31", active_flag: "Yes" },
      { user_id: "U2", activity_date: "2026-01-03", active_flag: "Yes" },
      { user_id: "U3", activity_date: "2026-01-31", active_flag: "Yes" },
    ]),
    dataset("simulated.xlsx / 05_Task_Activity", "05_Task_Activity", [
      { activity_id: "A1", task_status: "Completed", task_viewed_at: "2026-01-02T10:00:00Z", task_started_at: "2026-01-02T10:00:15Z", task_completed_at: "2026-01-02T10:00:45Z" },
      { activity_id: "A2", task_status: "Abandoned", task_viewed_at: "2026-01-03T10:00:00Z", task_started_at: null, task_completed_at: null },
    ]),
    dataset("simulated.xlsx / 06_Milestones", "06_Milestones", [
      { user_id: "U1", milestone_type: "first_task", milestone_datetime: "2026-01-08T10:00:00Z" },
    ]),
    dataset("simulated.xlsx / 08_Data_Dictionary", "08_Data_Dictionary", [
      { dataset: "Users", field_name: "user_id", definition: "Unique simulated user identifier" },
      { dataset: "Users", field_name: "email", definition: "Email address" },
    ]),
  ];
}

function metric(model, name) {
  return model.kpis.find((item) => item.name === name);
}

test("calculates supported KPIs from the actual grain and validates durations", () => {
  const model = analytics.calculate(fixture());
  assert.equal(model.kpis.length, 35);
  assert.equal(metric(model, "Total Registered Users").value, 3);
  assert.equal(metric(model, "Daily Active Users").value, 2);
  assert.equal(metric(model, "Average Session Duration").value, 30);
  assert.equal(metric(model, "Average Events per Session").value, 0.67);
  assert.equal(metric(model, "Task Completion Rate").value, 50);
  assert.equal(metric(model, "Average Task Completion Time").value, 30);
  assert.equal(metric(model, "Day 1 Retention").value, 100);
  assert.equal(metric(model, "Day 7 Retention").value, 50);
  assert.equal(metric(model, "Day 30 Retention").value, 100);
  assert.equal(metric(model, "XP-related Milestone Activity").status, "Partially Calculable");
  assert.ok(model.quality.some((finding) => finding.id === "negative_numeric" && finding.field === "session_duration_seconds"));
  assert.ok(model.quality.some((finding) => finding.id === "session_event_count_mismatch" && finding.affected === 2));
});

test("date filters apply to activity while retention censors unobserved cohorts", () => {
  const model = analytics.calculate(fixture(), "2026-01-03", "2026-01-08");
  assert.equal(metric(model, "Daily Active Users").value, 1);
  assert.equal(metric(model, "Day 7 Retention").status, "Not Calculable");
  assert.equal(model.charts.cohort.some((row) => row.cohort === "2026-01"), false);
});

test("builds candidate relationships and reports orphan and duplicate keys", () => {
  const sources = fixture();
  const events = sources.find((item) => item.sheetName === "03_Feature_Events");
  events.rows.push(["E2", "MISSING_USER", "NO_SESSION", "2026-01-04T10:00:00Z", "Tasks", "Failed", "No", "Web"]);
  const model = analytics.calculate(sources);
  const eventUser = model.relationships.find((row) => row.dataset === events.id && row.field === "user_id");
  const eventSession = model.relationships.find((row) => row.dataset === events.id && row.field === "session_id");
  assert.equal(eventUser.orphanRows, 1);
  assert.equal(eventSession.orphanRows, 1);
  assert.ok(model.quality.some((finding) => finding.id === "orphan_foreign_key"));
  assert.ok(model.quality.some((finding) => finding.id === "duplicate_identifier" && finding.dataset === events.id && finding.field === "event_id"));
  assert.ok(!model.quality.some((finding) => finding.id === "duplicate_identifier" && finding.dataset.includes("02_Sessions") && finding.field === "user_id"));
});

test("dictionary redacts direct identifiers and marks undocumented observed fields", () => {
  const model = analytics.calculate(fixture());
  const email = model.dictionary.find((row) => row.field === "email");
  const field = model.dictionary.find((row) => row.field === "state");
  assert.equal(email.example, "[REDACTED]");
  assert.equal(email.status, "Confirmed in supplied dictionary");
  assert.equal(field.status, "Observed field — definition proposed");
});

test("empty or incomplete workspaces report unavailable KPIs without fabricated values", () => {
  const empty = analytics.calculate([]);
  assert.equal(empty.kpis.length, 35);
  assert.ok(empty.kpis.every((item) => item.status === "Not Calculable"));
  const partial = analytics.calculate([dataset("events", "03_Feature_Events", [
    { event_id: "E1", event_datetime: "2026-01-01", user_id: "U1", feature_name: "Wallet", event_status: "Success" },
  ])]);
  assert.equal(metric(partial, "Total Registered Users").status, "Not Calculable");
  assert.equal(metric(partial, "Most Used Feature").status, "Calculable");
});
