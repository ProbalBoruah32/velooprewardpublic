(() => {
  "use strict";

  const normalize = (value) => String(value ?? "").trim().toLocaleLowerCase();
  const cleanId = (value) => normalize(value).replace(/[^a-z0-9]/g, "");
  const missing = (value) => value === null || value === undefined || (typeof value === "string" && !value.trim());
  const dateValue = (value) => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
    if (typeof value === "number" && value > 10000 && value < 100000) return Date.UTC(1899, 11, 30) + value * 86400000;
    const parsed = Date.parse(String(value ?? ""));
    return Number.isNaN(parsed) ? null : parsed;
  };
  const dayValue = (value) => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    }
    if (typeof value === "number" && value > 10000 && value < 100000) {
      return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
    }
    const text = String(value ?? "").trim();
    const datePrefix = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (datePrefix) {
      const parsed = new Date(Date.UTC(Number(datePrefix[1]), Number(datePrefix[2]) - 1, Number(datePrefix[3])));
      if (parsed.getUTCFullYear() === Number(datePrefix[1]) && parsed.getUTCMonth() === Number(datePrefix[2]) - 1 && parsed.getUTCDate() === Number(datePrefix[3])) return datePrefix.slice(1).join("-");
      return "";
    }
    const time = dateValue(value);
    if (time === null) return "";
    const local = new Date(time);
    return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
  };
  const inRange = (value, start, end) => {
    const day = dayValue(value);
    return Boolean(day && (!start || day >= start) && (!end || day <= end));
  };
  const isYes = (value) => ["yes", "true", "1", "active", "completed"].includes(normalize(value));
  const unique = (values) => new Set(values.filter((value) => !missing(value)).map(String));
  const round = (value, digits = 1) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
  const pct = (numerator, denominator) => denominator ? round(numerator / denominator * 100, 2) : null;

  function byColumns(datasets, required, preferred) {
    return datasets
      .filter((dataset) => required.every((field) => dataset.columns.includes(field)))
      .sort((left, right) => Number(Boolean(right.id.match(preferred))) - Number(Boolean(left.id.match(preferred))))[0] || null;
  }

  function objects(dataset) {
    if (!dataset) return [];
    const positions = new Map(dataset.columns.map((column, index) => [column, index]));
    return dataset.rows.map((row) => Object.fromEntries(dataset.columns.map((column, index) => [column, row[index] ?? null])));
  }

  function selectRows(rows, field, start, end) {
    return rows.filter((row) => inRange(row[field], start, end));
  }

  function availability(value, reason) {
    return {
      value: value === null || value === undefined || value === "" ? "—" : value,
      status: value === null || value === undefined ? "Not Calculable" : "Calculable",
      limitation: value === null || value === undefined ? reason : "",
    };
  }

  const KPI_DEFINITIONS = [
    ["Total Registered Users", "Users", "Count unique non-empty user_id values.", "COUNT(DISTINCT user_id)", "Daily", "Size of the registered cohort.", "Counts source user identifiers; does not imply active or verified users."],
    ["Verified User Rate", "Users", "Verified users divided by users with a verification status.", "Verified users / users with verification status", "Daily", "Monitor verification completion.", "Status values are taken from the supplied verification_status field."],
    ["Onboarding Completion Rate", "Users", "Users marked Completed divided by users with an onboarding status.", "Completed onboarding users / users with onboarding status", "Daily", "Understand onboarding completion.", "Uses onboarding_status labels, not inferred event sequences."],
    ["Active User Rate", "Users", "Users whose account_status is Active divided by registered users.", "Active account users / registered users", "Daily", "Describe account status mix.", "Account status is not evidence of product activity."],
    ["Users by Acquisition Source", "Users", "Registered users grouped by acquisition_source.", "COUNT(user_id) GROUP BY acquisition_source", "Daily", "Compare reported acquisition categories.", "Acquisition source is simulated and is not campaign attribution."],
    ["Users by Platform", "Users", "Registered users grouped by the supplied platform field.", "COUNT(user_id) GROUP BY platform", "Daily", "Review platform coverage.", "Primary user platform is Web in this sample; this is not session device usage."],
    ["Daily Active Users", "Daily Activity", "Unique users with active_flag Yes on the latest observed day in the selected range.", "COUNT(DISTINCT user_id) WHERE active_flag = Yes, latest activity_date", "Daily", "Track daily participation.", "Uses the Daily Activity active_flag and selected date window."],
    ["Monthly Active Users", "Daily Activity", "Unique active users in the 30 calendar days ending on the latest observed day in the range.", "COUNT(DISTINCT user_id) in trailing 30 observed calendar days", "Daily", "Track recent monthly participation.", "Rolling 30-day measure, not a calendar-month aggregation."],
    ["Average Sessions per User", "Sessions", "Sessions in range divided by registered users represented in those sessions.", "COUNT(session_id) / COUNT(DISTINCT user_id)", "Daily", "Summarize session frequency.", "Only users with a session in the selected period form the denominator."],
    ["Average Session Duration", "Sessions", "Mean non-negative session_duration_seconds for rows with valid session timestamps.", "MEAN(session_duration_seconds) after timestamp validation", "Daily", "Summarize session length.", "Excludes negative/missing durations and invalid/reversed timestamps."],
    ["Average Events per Session", "Feature Events + Sessions", "Feature event rows matched to Sessions, divided by all distinct sessions including sessions with no matched event.", "Matched Feature Events rows / COUNT(DISTINCT session_id in Sessions)", "Daily", "Summarize event density.", "Uses the event-grain sheet and session key; excludes duplicate audit-sheet rows. Session summary count semantics are cross-checked separately."],
    ["Average Active Days", "Daily Activity", "Mean distinct active calendar days per active user in the selected range.", "Active user-days / distinct active users", "Daily", "Describe engagement frequency.", "Uses qualifying Daily Activity rows only."],
    ["Returning User Rate", "Daily Activity", "Active users with activity on at least two distinct days divided by active users.", "Users active on 2+ distinct days / active users", "Daily", "Measure repeat participation.", "Within the selected date range; not a retention cohort metric."],
    ["Average Features per Session", "Sessions", "Mean supplied features_used_count for valid session records.", "MEAN(features_used_count)", "Daily", "Describe feature breadth per session.", "Uses the supplied session summary field."],
    ["Feature Adoption Rate", "Feature Events + Users", "Users with at least one feature event divided by registered users.", "Distinct event users / registered users", "Daily", "Measure observed feature reach.", "Event users are matched to the user source; use Feature Events, not the 15-row summary."],
    ["Feature Usage Frequency", "Feature Events", "Feature event rows divided by distinct users with feature events.", "COUNT(event_id) / COUNT(DISTINCT user_id)", "Daily", "Compare event frequency.", "Events are records, not users; limited to the selected date range."],
    ["Feature Success Rate", "Feature Events", "Events whose event_status is Success divided by events with a status.", "Success events / events with status", "Daily", "Review successful event outcomes.", "Uses exact supplied event_status values."],
    ["Feature Failure Rate", "Feature Events", "Events whose event_status is Failed divided by events with a status.", "Failed events / events with status", "Daily", "Review failed event outcomes.", "Abandoned and Started are not counted as failures."],
    ["Most Used Feature", "Feature Events", "Feature with the largest count of feature event records.", "ARG MAX(COUNT(event_id) GROUP BY feature_name)", "Daily", "Identify highest event volume features.", "Ranks events, not distinct users or feature adoption."],
    ["Events per Active User", "Feature Events + Daily Activity", "Events in range divided by users active in Daily Activity in range.", "COUNT(event_id) / COUNT(DISTINCT active user_id)", "Daily", "Compare event volume with active users.", "Activity denominator uses Daily Activity; event count is not de-duplicated by user."],
    ["Total Tasks Viewed", "Task Activity", "Count unique activity_id records with a valid task_viewed_at.", "COUNT(DISTINCT activity_id) WHERE task_viewed_at valid", "Daily", "Measure task-view activity.", "Task activity rows are not guaranteed to be unique tasks."],
    ["Total Tasks Started", "Task Activity", "Count unique activity_id records with a valid task_started_at.", "COUNT(DISTINCT activity_id) WHERE task_started_at valid", "Daily", "Measure task starts.", "A row is counted once even if task_id repeats."],
    ["Total Tasks Completed", "Task Activity", "Count unique activity_id records with a valid task_completed_at or Completed status.", "COUNT(DISTINCT activity_id) WHERE completion timestamp or Completed status", "Daily", "Measure task completions.", "Completion is based on the supplied lifecycle timestamp/status."],
    ["Task Completion Rate", "Task Activity", "Completed activity records divided by viewed activity records.", "Completed activity_id / viewed activity_id", "Daily", "Review task funnel completion.", "Denominator is unique viewed activity_id records in range."],
    ["Task Failure Rate", "Task Activity", "Failed activity records divided by viewed activity records.", "Failed activity_id / viewed activity_id", "Daily", "Review task failures.", "Denominator is unique viewed activity_id records in range."],
    ["Task Abandonment Rate", "Task Activity", "Abandoned activity records divided by viewed activity records.", "Abandoned activity_id / viewed activity_id", "Daily", "Review task abandonment.", "Denominator is unique viewed activity_id records in range."],
    ["Average Task Completion Time", "Task Activity", "Mean valid non-negative seconds from task_started_at to task_completed_at.", "MEAN(task_completed_at - task_started_at)", "Daily", "Understand completion time.", "Only valid paired timestamps with non-negative elapsed time are included."],
    ["Day 1 Retention", "Users + Daily Activity", "Eligible registration cohorts active exactly one calendar day after registration.", "Eligible cohort users active on registration date + 1 / eligible cohort users", "Daily", "Measure next-day return.", "Only cohorts with a fully observed day-1 window are included."],
    ["Day 7 Retention", "Users + Daily Activity", "Eligible registration cohorts active exactly seven calendar days after registration.", "Eligible cohort users active on registration date + 7 / eligible cohort users", "Daily", "Measure week-one return.", "Only cohorts with a fully observed day-7 window are included."],
    ["Day 30 Retention", "Users + Daily Activity", "Eligible registration cohorts active exactly 30 calendar days after registration.", "Eligible cohort users active on registration date + 30 / eligible cohort users", "Daily", "Measure month-one return.", "Only cohorts with a fully observed day-30 window are included."],
    ["Weekly Returning Users", "Daily Activity", "Users active in at least two distinct ISO calendar weeks.", "COUNT(DISTINCT user_id) active in 2+ ISO weeks", "Weekly", "Measure cross-week return.", "Selected-window activity is grouped by ISO week."],
    ["Total Milestones Achieved", "Milestones", "Count milestone records with a valid milestone_datetime.", "COUNT(milestone records)", "Daily", "Summarize recorded progression.", "Rows are milestone records, not necessarily distinct milestone types."],
    ["Milestone Frequency", "Milestones", "Milestone records divided by users with at least one milestone.", "COUNT(milestones) / COUNT(DISTINCT user_id)", "Daily", "Compare milestone activity frequency.", "Uses milestone rows, not inferred progression events."],
    ["Average Milestones per User", "Milestones + Users", "Milestone records divided by all registered users.", "COUNT(milestones) / COUNT(registered user_id)", "Daily", "Summarize progression coverage.", "Includes registered users with no milestone records in denominator."],
    ["XP-related Milestone Activity", "Feature Events", "Count of feature event rows marked Yes for xp_related_flag.", "COUNT(event_id) WHERE xp_related_flag = Yes", "Daily", "Expose observed XP-related activity.", "This source flag is on Feature Events, not the Milestones dataset."],
  ];
  const KPI_REQUIRED_FIELDS = {
    "Total Registered Users": "user_id",
    "Verified User Rate": "user_id; verification_status",
    "Onboarding Completion Rate": "user_id; onboarding_status",
    "Active User Rate": "user_id; account_status",
    "Users by Acquisition Source": "user_id; acquisition_source",
    "Users by Platform": "user_id; platform",
    "Daily Active Users": "user_id; activity_date; active_flag",
    "Monthly Active Users": "user_id; activity_date; active_flag",
    "Average Sessions per User": "session_id; user_id; session_start",
    "Average Session Duration": "session_id; session_start; session_end; session_duration_seconds",
    "Average Events per Session": "event_id; session_id; event_datetime",
    "Average Active Days": "user_id; activity_date; active_flag",
    "Returning User Rate": "user_id; activity_date; active_flag",
    "Average Features per Session": "session_id; features_used_count",
    "Feature Adoption Rate": "event_id; user_id; feature_name; registered user_id",
    "Feature Usage Frequency": "event_id; user_id; event_datetime",
    "Feature Success Rate": "event_id; event_status; event_datetime",
    "Feature Failure Rate": "event_id; event_status; event_datetime",
    "Most Used Feature": "event_id; feature_name; event_datetime",
    "Events per Active User": "event_id; user_id; activity_date; active_flag",
    "Total Tasks Viewed": "activity_id; task_viewed_at",
    "Total Tasks Started": "activity_id; task_started_at",
    "Total Tasks Completed": "activity_id; task_completed_at; task_status",
    "Task Completion Rate": "activity_id; task_viewed_at; task_completed_at; task_status",
    "Task Failure Rate": "activity_id; task_viewed_at; task_status",
    "Task Abandonment Rate": "activity_id; task_viewed_at; task_status",
    "Average Task Completion Time": "activity_id; task_started_at; task_completed_at",
    "Day 1 Retention": "user_id; registration_datetime; activity_date; active_flag",
    "Day 7 Retention": "user_id; registration_datetime; activity_date; active_flag",
    "Day 30 Retention": "user_id; registration_datetime; activity_date; active_flag",
    "Weekly Returning Users": "user_id; activity_date; active_flag",
    "Total Milestones Achieved": "user_id; milestone_type; milestone_datetime",
    "Milestone Frequency": "user_id; milestone_type; milestone_datetime",
    "Average Milestones per User": "user_id; milestone_type; milestone_datetime; registered user_id",
    "XP-related Milestone Activity": "event_id; event_datetime; xp_related_flag",
  };

  function modelDatasetName(key, sources) {
    return sources[key]?.id || `Not supplied (${key})`;
  }

  function calculate(datasets, start = "", end = "") {
    const usersDs = byColumns(datasets, ["user_id", "registration_datetime"], /01_Users_1000|Users_1000_Clean/i);
    const sessionsDs = byColumns(datasets, ["session_id", "user_id", "session_start", "session_end", "session_duration_seconds"], /02_Sessions/i);
    const eventsDs = byColumns(datasets, ["event_id", "user_id", "event_datetime", "feature_name", "event_status"], /03_Feature_Events/i);
    const activityDs = byColumns(datasets, ["user_id", "activity_date", "active_flag"], /04_Daily_Activity/i);
    const tasksDs = byColumns(datasets, ["activity_id", "task_status", "task_viewed_at"], /05_Task_Activity/i);
    const milestonesDs = byColumns(datasets, ["user_id", "milestone_type", "milestone_datetime"], /06_Milestones/i);
    const dictionaryDs = byColumns(datasets, ["field_name", "definition"], /08_Data_Dictionary|Data_Dictionary/i);

    const users = objects(usersDs);
    const allSessions = objects(sessionsDs);
    const allTaskRows = objects(tasksDs);
    const allMilestoneRows = objects(milestonesDs);
    const sessions = selectRows(allSessions, "session_start", start, end);
    const allEvents = selectRows(objects(eventsDs), "event_datetime", start, end);
    const activity = selectRows(objects(activityDs), "activity_date", start, end).filter((row) => isYes(row.active_flag));
    const allActivity = objects(activityDs).filter((row) => isYes(row.active_flag));
    const tasks = selectRows(allTaskRows, "task_viewed_at", start, end);
    const milestones = selectRows(allMilestoneRows, "milestone_datetime", start, end);
    const maxDay = (values) => values.map(dayValue).filter(Boolean).sort().at(-1) || "";
    const observedLatest = maxDay(activity.map((row) => row.activity_date));
    const observedThrough = maxDay(allActivity.map((row) => row.activity_date));
    const observationCutoff = end && observedThrough && end < observedThrough ? end : observedThrough;
    const latestActivityRows = activity.filter((row) => dayValue(row.activity_date) === observedLatest);
    const activeUsers = unique(activity.map((row) => row.user_id));
    const activeInRange = new Set(activeUsers);
    const activeByUser = new Map();
    for (const row of activity) {
      if (!activeByUser.has(String(row.user_id))) activeByUser.set(String(row.user_id), new Set());
      activeByUser.get(String(row.user_id)).add(dayValue(row.activity_date));
    }
    const registeredUserIds = unique(users.map((row) => row.user_id));
    const featureUsers = unique(allEvents.map((row) => row.user_id).filter((userId) => !usersDs || registeredUserIds.has(String(userId))));
    const statuses = allEvents.map((row) => normalize(row.event_status));
    const validSessions = sessions.filter((row) => {
      const startTime = dateValue(row.session_start);
      const endTime = dateValue(row.session_end);
      const duration = Number(row.session_duration_seconds);
      return startTime !== null && endTime !== null && endTime >= startTime && Number.isFinite(duration) && duration >= 0;
    });
    const knownSessionIds = new Set(sessions.map((row) => String(row.session_id)).filter((sessionId) => sessionId !== "null" && sessionId !== "undefined"));
    const matchedEvents = allEvents.filter((row) => knownSessionIds.has(String(row.session_id)));
    const sessionUserIds = unique(sessions.map((row) => row.user_id));
    const viewed = unique(tasks.filter((row) => dateValue(row.task_viewed_at) !== null).map((row) => row.activity_id));
    const started = unique(tasks.filter((row) => dateValue(row.task_started_at) !== null).map((row) => row.activity_id));
    const completedRows = tasks.filter((row) => dateValue(row.task_completed_at) !== null || normalize(row.task_status) === "completed");
    const completed = unique(completedRows.map((row) => row.activity_id));
    const failed = unique(tasks.filter((row) => normalize(row.task_status) === "failed").map((row) => row.activity_id));
    const abandoned = unique(tasks.filter((row) => normalize(row.task_status) === "abandoned").map((row) => row.activity_id));
    const taskDurations = tasks.map((row) => {
      const from = dateValue(row.task_started_at);
      const to = dateValue(row.task_completed_at);
      return from === null || to === null || to < from ? null : (to - from) / 1000;
    }).filter((value) => value !== null);
    const featureCounts = new Map();
    for (const row of allEvents) featureCounts.set(String(row.feature_name), (featureCounts.get(String(row.feature_name)) || 0) + 1);
    const topFeature = Array.from(featureCounts.entries()).sort((left, right) => right[1] - left[1])[0];
    const registrationStatuses = users.map((row) => normalize(row.verification_status)).filter(Boolean);
    const onboardingStatuses = users.map((row) => normalize(row.onboarding_status)).filter(Boolean);
    const activeAccountUsers = users.filter((row) => normalize(row.account_status) === "active").length;
    const sessionSummaryCheck = sessionEventSummary(datasets);
    const distinctSessions = unique(sessions.map((row) => row.session_id)).size;
    const avgEvents = distinctSessions ? matchedEvents.length / distinctSessions : null;
    const activeDays = Array.from(activeByUser.values(), (days) => days.size);
    const returningUsers = activeDays.filter((count) => count >= 2).length;
    const maxActivityTime = observedLatest ? Date.parse(`${observedLatest}T00:00:00Z`) : null;
    const rollingStart = maxActivityTime === null ? "" : new Date(maxActivityTime - 29 * 86400000).toISOString().slice(0, 10);
    const rollingUsers = unique(activity.filter((row) => !rollingStart || dayValue(row.activity_date) >= rollingStart).map((row) => row.user_id));
    const metricValues = {
      "Total Registered Users": usersDs ? unique(users.map((row) => row.user_id)).size : null,
      "Verified User Rate": usersDs && registrationStatuses.length ? pct(registrationStatuses.filter((status) => status === "verified").length, registrationStatuses.length) : null,
      "Onboarding Completion Rate": usersDs && onboardingStatuses.length ? pct(onboardingStatuses.filter((status) => status === "completed").length, onboardingStatuses.length) : null,
      "Active User Rate": usersDs ? pct(activeAccountUsers, users.length) : null,
      "Users by Acquisition Source": usersDs && users.some((row) => !missing(row.acquisition_source)) ? "Available by category" : null,
      "Users by Platform": usersDs && users.some((row) => !missing(row.platform)) ? "Available by category" : null,
      "Daily Active Users": activityDs && observedLatest ? unique(latestActivityRows.map((row) => row.user_id)).size : null,
      "Monthly Active Users": activityDs && observedLatest ? rollingUsers.size : null,
      "Average Sessions per User": sessionsDs && sessionUserIds.size ? round(unique(sessions.map((row) => row.session_id)).size / sessionUserIds.size, 2) : null,
      "Average Session Duration": validSessions.length ? round(validSessions.reduce((sum, row) => sum + Number(row.session_duration_seconds), 0) / validSessions.length, 2) : null,
      "Average Events per Session": eventsDs && sessionsDs ? round(avgEvents, 2) : null,
      "Average Active Days": activeDays.length ? round(activeDays.reduce((sum, count) => sum + count, 0) / activeDays.length, 2) : null,
      "Returning User Rate": activeUsers.size ? pct(returningUsers, activeUsers.size) : null,
      "Average Features per Session": sessionsDs && sessions.length ? round(sessions.reduce((sum, row) => sum + (Number(row.features_used_count) || 0), 0) / sessions.length, 2) : null,
      "Feature Adoption Rate": usersDs && allEvents.length ? pct(featureUsers.size, unique(users.map((row) => row.user_id)).size) : null,
      "Feature Usage Frequency": featureUsers.size ? round(allEvents.length / featureUsers.size, 2) : null,
      "Feature Success Rate": statuses.filter(Boolean).length ? pct(statuses.filter((status) => status === "success").length, statuses.filter(Boolean).length) : null,
      "Feature Failure Rate": statuses.filter(Boolean).length ? pct(statuses.filter((status) => status === "failed").length, statuses.filter(Boolean).length) : null,
      "Most Used Feature": topFeature ? `${topFeature[0]} (${topFeature[1].toLocaleString()} events)` : null,
      "Events per Active User": activeUsers.size ? round(allEvents.length / activeUsers.size, 2) : null,
      "Total Tasks Viewed": tasksDs ? viewed.size : null,
      "Total Tasks Started": tasksDs ? started.size : null,
      "Total Tasks Completed": tasksDs ? completed.size : null,
      "Task Completion Rate": viewed.size ? pct(completed.size, viewed.size) : null,
      "Task Failure Rate": viewed.size ? pct(failed.size, viewed.size) : null,
      "Task Abandonment Rate": viewed.size ? pct(abandoned.size, viewed.size) : null,
      "Average Task Completion Time": taskDurations.length ? round(taskDurations.reduce((sum, value) => sum + value, 0) / taskDurations.length, 2) : null,
      "Day 1 Retention": retention(users, activity, 1, observationCutoff, start, end),
      "Day 7 Retention": retention(users, activity, 7, observationCutoff, start, end),
      "Day 30 Retention": retention(users, activity, 30, observationCutoff, start, end),
      "Weekly Returning Users": activityDs ? weeklyReturners(activity) : null,
      "Total Milestones Achieved": milestonesDs ? milestones.length : null,
      "Milestone Frequency": unique(milestones.map((row) => row.user_id)).size ? round(milestones.length / unique(milestones.map((row) => row.user_id)).size, 2) : null,
      "Average Milestones per User": usersDs && users.length ? round(milestones.length / unique(users.map((row) => row.user_id)).size, 2) : null,
      "XP-related Milestone Activity": eventsDs && allEvents.some((row) => "xp_related_flag" in row) ? allEvents.filter((row) => isYes(row.xp_related_flag)).length : null,
    };

    const sourceKeys = {
      Users: ["users"],
      Sessions: ["sessions"],
      "Feature Events + Sessions": ["events", "sessions"],
      "Daily Activity": ["activity"],
      "Feature Events + Users": ["events", "users"],
      "Feature Events": ["events"],
      "Task Activity": ["tasks"],
      "Users + Daily Activity": ["users", "activity"],
      "Milestones": ["milestones"],
      "Milestones + Users": ["milestones", "users"],
    };
    const kpis = KPI_DEFINITIONS.map(([name, source, definition, formula, frequency, purpose, limitation]) => {
      const computed = availability(metricValues[name], `Required fields from ${source} are not present or have no valid observations.`);
      const sourceDataset = (sourceKeys[source] || []).map((key) => modelDatasetName(key, {
        users: usersDs, sessions: sessionsDs, events: eventsDs, activity: activityDs, tasks: tasksDs, milestones: milestonesDs,
      })).join("; ");
      const sessionWarning = name === "Average Events per Session" && sessionSummaryCheck?.mismatched
        ? ` The supplied events_in_session summary mismatches the event log for ${sessionSummaryCheck.mismatched.toLocaleString()} of ${sessionSummaryCheck.total.toLocaleString()} sessions, so it is not used.`
        : "";
      return { name, source, sourceDataset, definition, formula, requiredFields: KPI_REQUIRED_FIELDS[name], value: computed.value, status: computed.status, frequency, purpose, interpretation: purpose, limitation: (computed.limitation || limitation) + sessionWarning };
    });
    if (usersDs) {
      for (const [label, field] of [["Users by Acquisition Source", "acquisition_source"], ["Users by Platform", "platform"]]) {
        const values = users.map((row) => row[field]).filter((value) => !missing(value));
        const counts = new Map();
        values.forEach((value) => counts.set(String(value), (counts.get(String(value)) || 0) + 1));
        const item = kpis.find((entry) => entry.name === label);
        if (counts.size && item) item.value = Array.from(counts.entries()).sort((left, right) => right[1] - left[1]).map(([category, count]) => `${category}: ${count}`).join("; ");
      }
    }
    const xpMetric = kpis.find((entry) => entry.name === "XP-related Milestone Activity");
    if (xpMetric && xpMetric.value !== "—") {
      xpMetric.status = "Partially Calculable";
      xpMetric.limitation = "Feature Events contain xp_related_flag; the Milestones dataset has no XP field to establish milestone-specific XP attribution.";
    }
    const unavailable = [
      ["Reward Transactions", "No reward transaction ledger was supplied.", "Reward transaction id, user id, event time, reward type, amount, status, reversal link.", "High"],
      ["Wallet Transactions", "No wallet transaction ledger was supplied.", "Transaction id, user id, event time, transaction type, amount, currency, balance, status.", "High"],
      ["Withdrawals", "No withdrawal lifecycle records were supplied.", "Withdrawal id, user id, requested/approved/paid timestamps, amount, currency, status, failure reason.", "High"],
      ["Referral Transactions", "No referral lifecycle or attribution ledger was supplied.", "Referrer id, referred user id, referral code, event time, qualification state, reward link.", "High"],
      ["Support Tickets", "No support ticket dataset was supplied.", "Ticket id, user id, created/resolved timestamps, category, priority, status, resolution reason.", "Medium"],
      ["Advertising Revenue", "No ad impression/click/revenue dataset was supplied.", "Event id, user id, campaign/placement, impression/click timestamps, revenue, currency, status.", "High"],
      ["Campaign Acquisition Data", "No campaign cost or attribution dataset was supplied.", "Campaign id, source, medium, spend, click/conversion time, attribution window, user id.", "Medium"],
    ].map(([area, reason, fields, priority]) => ({ area, reason, fields, priority, status: "Proposed – Data Required" }));

    return {
      sources: { users: usersDs, sessions: sessionsDs, events: eventsDs, activity: activityDs, tasks: tasksDs, milestones: milestonesDs, dictionary: dictionaryDs },
      rows: { users, sessions, events: allEvents, activity, tasks, milestones },
      kpis,
      unavailable,
      latestActivityDate: observedLatest,
      ranges: {
        activityDays: Array.from(new Set([
          ...users.map((row) => dayValue(row.registration_datetime)),
          ...allSessions.map((row) => dayValue(row.session_start)),
          ...objects(eventsDs).map((row) => dayValue(row.event_datetime)),
          ...allActivity.map((row) => dayValue(row.activity_date)),
          ...allTaskRows.map((row) => dayValue(row.task_viewed_at)),
          ...allMilestoneRows.map((row) => dayValue(row.milestone_datetime)),
        ].filter(Boolean))).sort(),
      },
      charts: {
        activityByDay: groupCount(activity, (row) => dayValue(row.activity_date)),
        registrationsByDay: groupCount(selectRows(users, "registration_datetime", start, end), (row) => dayValue(row.registration_datetime)),
        sessionsByDay: groupCount(sessions, (row) => dayValue(row.session_start)),
        features: Array.from(featureCounts.entries()).sort((left, right) => right[1] - left[1]).map(([name, count]) => ({ name, count })),
        taskFunnel: [{ name: "Viewed", value: viewed.size }, { name: "Started", value: started.size }, { name: "Completed", value: completed.size }],
        taskStatuses: groupCount(tasks, (row) => String(row.task_status || "(missing)")),
        taskCategories: groupCount(tasks, (row) => String(row.task_category || "(missing)")),
        tasksByDay: groupCount(tasks, (row) => dayValue(row.task_viewed_at)),
        sessionStatuses: groupCount(sessions, (row) => String(row.session_status || "(missing)")),
        sessionEntryPoints: groupCount(sessions, (row) => String(row.entry_point || "(missing)")),
        sessionExitFeatures: groupCount(sessions, (row) => String(row.exit_feature || "(missing)")),
        sessionPlatforms: groupCount(sessions, (row) => String(row.platform || "(missing)")),
        sessionDevices: groupCount(sessions, (row) => String(row.device || "(missing)")),
        eventStatuses: groupCount(allEvents, (row) => String(row.event_status || "(missing)")),
        eventPlatforms: groupCount(allEvents, (row) => String(row.platform || "(missing)")),
        featurePlatforms: groupCount(allEvents, (row) => `${row.feature_name || "(missing)"} · ${row.platform || "(missing)"}`),
        milestoneTypes: groupCount(milestones, (row) => String(row.milestone_type || "(missing)")),
        milestoneUsers: groupCount(milestones, (row) => String(row.user_id || "(missing)")).sort((left, right) => right.count - left.count),
        milestonesByDay: groupCount(milestones, (row) => dayValue(row.milestone_datetime)),
        xpEvents: groupCount(allEvents, (row) => isYes(row.xp_related_flag) ? "XP-related" : "Not XP-related"),
        userStatus: groupCount(users, (row) => String(row.account_status || "(missing)")),
        activityStatus: groupCount(users, (row) => activeInRange.has(String(row.user_id)) ? "Active in selected range" : "No observed activity in range"),
        verification: groupCount(users, (row) => String(row.verification_status || "(missing)")),
        onboarding: groupCount(users, (row) => String(row.onboarding_status || "(missing)")),
        platform: groupCount(users, (row) => String(row.platform || "(missing)")),
        acquisition: groupCount(users, (row) => String(row.acquisition_source || "(missing)")),
        geography: groupCount(users, (row) => String(row.state || "(missing)")),
        cohort: cohortTable(users, activity, observationCutoff, start, end),
        users: userActivityRows(users, activity),
      },
      quality: qualityFindings(datasets).concat(
        relationships(datasets).filter((row) => row.orphanRows).map((row) => ({
          id: "orphan_foreign_key",
          dataset: row.dataset,
          field: row.field,
          type: "Orphan relationship values",
          affected: row.orphanRows,
          severity: "High",
          logic: `${row.orphanRows} non-empty values do not match the candidate ${row.referenceKey} key.`,
          suggestion: "Review key mapping and source extraction before joining.",
          prevention: "Validate references against an approved parent key.",
        })),
      ),
      relationships: relationships(datasets),
      dictionary: buildDictionary(datasets, dictionaryDs),
    };
  }

  function groupCount(rows, keyOf) {
    const counts = new Map();
    rows.forEach((row) => {
      const key = keyOf(row);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
      .map(([name, count]) => ({ name, count }));
  }

  function retention(users, activity, day, cutoff, start = "", end = "") {
    if (!users.length || !activity.length || !cutoff) return null;
    const active = new Set(activity.map((row) => `${row.user_id}|${dayValue(row.activity_date)}`));
    const cutoffTime = Date.parse(`${cutoff}T00:00:00Z`);
    const eligible = users.filter((row) => {
      const registration = dayValue(row.registration_datetime);
      const registrationTime = Date.parse(`${registration}T00:00:00Z`);
      return registration && (!start || registration >= start) && (!end || registration <= end) && registrationTime + day * 86400000 <= cutoffTime;
    });
    if (!eligible.length) return null;
    const returned = eligible.filter((row) => {
      const registration = dayValue(row.registration_datetime);
      const target = new Date(Date.parse(`${registration}T00:00:00Z`) + day * 86400000).toISOString().slice(0, 10);
      return active.has(`${row.user_id}|${target}`);
    }).length;
    return pct(returned, eligible.length);
  }

  function weekKey(value) {
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return "";
    const day = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - day + 3);
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }

  function weeklyReturners(activity) {
    const weeks = new Map();
    activity.forEach((row) => {
      const key = String(row.user_id);
      if (!weeks.has(key)) weeks.set(key, new Set());
      weeks.get(key).add(weekKey(dayValue(row.activity_date)));
    });
    return Array.from(weeks.values()).filter((value) => value.size >= 2).length;
  }

  function cohortTable(users, activity, cutoff, start = "", end = "") {
    if (!users.length || !activity.length || !cutoff) return [];
    const active = new Set(activity.map((row) => `${row.user_id}|${dayValue(row.activity_date)}`));
    const cohorts = new Map();
    users.forEach((row) => {
      const registered = dayValue(row.registration_datetime);
      if (!registered || (start && registered < start) || (end && registered > end)) return;
      const cohort = registered.slice(0, 7);
      if (!cohorts.has(cohort)) cohorts.set(cohort, []);
      cohorts.get(cohort).push(row);
    });
    return Array.from(cohorts.entries()).sort((left, right) => left[0].localeCompare(right[0])).map(([cohort, members]) => {
      const eligibleDays = [1, 7, 30].map((day) => {
        const eligible = members.filter((user) => {
          const regDay = dayValue(user.registration_datetime);
          const target = new Date(Date.parse(`${regDay}T00:00:00Z`) + day * 86400000).toISOString().slice(0, 10);
          return target <= cutoff;
        });
        if (!eligible.length) return { count: null, rate: null, eligible: 0 };
        const returned = eligible.filter((user) => {
          const regDay = dayValue(user.registration_datetime);
          const target = new Date(Date.parse(`${regDay}T00:00:00Z`) + day * 86400000).toISOString().slice(0, 10);
          return active.has(`${user.user_id}|${target}`);
        }).length;
        return { count: returned, rate: pct(returned, eligible.length), eligible: eligible.length };
      });
      return { cohort, users: members.length, d1: eligibleDays[0], d7: eligibleDays[1], d30: eligibleDays[2] };
    });
  }

  function userActivityRows(users, activity) {
    const daysByUser = new Map();
    activity.forEach((row) => {
      const id = String(row.user_id);
      if (!daysByUser.has(id)) daysByUser.set(id, new Set());
      daysByUser.get(id).add(dayValue(row.activity_date));
    });
    return users.map((user) => ({
      user_id: user.user_id,
      registration_date: dayValue(user.registration_datetime),
      account_status: user.account_status || "",
      verification_status: user.verification_status || "",
      onboarding_status: user.onboarding_status || "",
      acquisition_source: user.acquisition_source || "",
      active_days: daysByUser.get(String(user.user_id))?.size || 0,
    })).sort((left, right) => right.active_days - left.active_days);
  }

  function qualityFindings(datasets) {
    const findings = [];
    const sessionCheck = sessionEventSummary(datasets);
    datasets.forEach((dataset) => {
      dataset.profile.forEach((profile) => {
        if (profile.missingCount) findings.push({ id: "missing_values", dataset: dataset.id, field: profile.column, type: "Missing values", affected: profile.missingCount, severity: "Info", logic: "Counted null/blank cells.", suggestion: "Confirm the field's expected nullability.", prevention: "Define and validate field-specific requiredness." });
        if (profile.dateInvalid) findings.push({ id: "invalid_dates", dataset: dataset.id, field: profile.column, type: "Invalid dates", affected: profile.dateInvalid, severity: "High", logic: "Non-empty date-like values that could not be parsed.", suggestion: "Review source formatting and timezone.", prevention: "Validate dates at ingestion." });
        const values = dataset.rows.map((row) => row[dataset.columns.indexOf(profile.column)]).filter((value) => typeof value === "string" && value.trim() !== "");
        const whitespace = values.filter((value) => value !== value.trim()).length;
        if (whitespace) findings.push({ id: "whitespace", dataset: dataset.id, field: profile.column, type: "Leading/trailing spaces", affected: whitespace, severity: "Low", logic: "String differs from its trimmed value.", suggestion: "Normalize values in a reviewed downstream copy.", prevention: "Trim/validate text during ingestion." });
        const categoryForms = new Map();
        values.forEach((value) => {
          const canonical = value.trim().toLocaleLowerCase();
          if (!categoryForms.has(canonical)) categoryForms.set(canonical, new Map());
          const variants = categoryForms.get(canonical);
          variants.set(value.trim(), (variants.get(value.trim()) || 0) + 1);
        });
        const inconsistent = Array.from(categoryForms.values()).filter((forms) => forms.size > 1).reduce((sum, forms) => sum + Array.from(forms.values()).reduce((count, amount) => count + amount, 0), 0);
        if (inconsistent) findings.push({ id: "category_capitalization", dataset: dataset.id, field: profile.column, type: "Inconsistent category capitalization", affected: inconsistent, severity: "Low", logic: "Distinct string forms collapse to the same trimmed lowercase category.", suggestion: "Confirm canonical category labels before normalizing.", prevention: "Validate against an approved category set." });
        const validStatuses = {
          account_status: new Set(["active", "inactive", "pending verification", "suspended"]),
          verification_status: new Set(["verified", "pending"]),
          onboarding_status: new Set(["completed", "started", "not started"]),
          task_status: new Set(["completed", "abandoned", "failed", "pending"]),
          session_status: new Set(["completed"]),
          event_status: new Set(["started", "success", "abandoned", "failed"]),
        }[profile.column];
        if (validStatuses) {
          const invalid = values.filter((value) => !validStatuses.has(value.trim().toLocaleLowerCase())).length;
          if (invalid) findings.push({ id: "invalid_category", dataset: dataset.id, field: profile.column, type: "Unrecognized status/category", affected: invalid, severity: "Medium", logic: "Non-empty value does not match the observed status vocabulary.", suggestion: "Review against documented status semantics.", prevention: "Validate status values against the approved vocabulary." });
        }
        if (/duration|seconds|minutes|count|amount|sequence|score|xp|numeric|value/i.test(profile.column)) {
          const invalid = values.filter((value) => !Number.isFinite(Number(value))).length;
          if (invalid) findings.push({ id: "invalid_numeric", dataset: dataset.id, field: profile.column, type: "Invalid numeric values", affected: invalid, severity: "Medium", logic: "Numeric-measure candidate contains non-numeric strings.", suggestion: "Review the source representation without replacing original values.", prevention: "Add type and range checks at ingestion." });
        }
      });
      if (dataset.duplicateRows) findings.push({ id: "duplicate_rows", dataset: dataset.id, field: "", type: "Duplicate rows", affected: dataset.duplicateRows, severity: "Medium", logic: "Rows in exact duplicate groups.", suggestion: "Review event identity before deduplicating.", prevention: "Enforce source keys and idempotent imports." });
      const primaryKey = primaryKeyFields(dataset);
      if (primaryKey.length && primaryKey.every((field) => dataset.columns.includes(field))) {
        const keyIndices = primaryKey.map((field) => dataset.columns.indexOf(field));
        const keyCounts = new Map();
        dataset.rows.forEach((row) => {
          const parts = keyIndices.map((index) => row[index]);
          if (parts.some(missing)) return;
          const key = JSON.stringify(parts);
          keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
        });
        const duplicates = Array.from(keyCounts.values()).filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
        if (duplicates) findings.push({ id: "duplicate_identifier", dataset: dataset.id, field: primaryKey.join(" + "), type: "Duplicate primary key", affected: duplicates, severity: "High", logic: `${duplicates} rows participate in duplicate ${primaryKey.join(" + ")} key groups.`, suggestion: "Review entity identity before deduplicating.", prevention: "Validate the documented primary key or composite key at ingestion." });
      }
      dataset.profile.filter((profile) => /duration|seconds|minutes|count|amount|value|sequence/i.test(profile.column) && typeof profile.min === "number" && profile.min < 0).forEach((profile) => {
        const values = dataset.rows.map((row) => Number(row[dataset.columns.indexOf(profile.column)]));
        const negatives = values.filter((value) => Number.isFinite(value) && value < 0).length;
        if (negatives) findings.push({ id: "negative_numeric", dataset: dataset.id, field: profile.column, type: "Negative numeric values", affected: negatives, severity: "Medium", logic: "Negative values in a non-negative measure candidate.", suggestion: "Validate business meaning; do not overwrite source values.", prevention: "Apply range checks based on confirmed field semantics." });
      });
      if (dataset.columns.includes("session_start") && dataset.columns.includes("session_end")) {
        const startIndex = dataset.columns.indexOf("session_start");
        const endIndex = dataset.columns.indexOf("session_end");
        const invalid = dataset.rows.filter((row) => {
          const from = dateValue(row[startIndex]);
          const to = dateValue(row[endIndex]);
          return from !== null && to !== null && to < from;
        }).length;
        if (invalid) findings.push({ id: "invalid_session_duration", dataset: dataset.id, field: "session_start / session_end", type: "Negative session duration", affected: invalid, severity: "High", logic: "Session end timestamp precedes session start.", suggestion: "Exclude from duration metrics and investigate source timestamps.", prevention: "Validate timestamp ordering before publishing sessions." });
      }
      if (dataset.columns.includes("task_viewed_at") && dataset.columns.includes("task_started_at") && dataset.columns.includes("task_completed_at")) {
        const indices = ["task_viewed_at", "task_started_at", "task_completed_at"].map((field) => dataset.columns.indexOf(field));
        const impossible = dataset.rows.filter((row) => {
          const times = indices.map((index) => dateValue(row[index]));
          return (times[0] !== null && times[1] !== null && times[1] < times[0])
            || (times[1] !== null && times[2] !== null && times[2] < times[1])
            || (normalize(row[dataset.columns.indexOf("task_status")]) === "completed" && times[2] === null);
        }).length;
        if (impossible) findings.push({ id: "invalid_task_transition", dataset: dataset.id, field: "task_viewed_at / task_started_at / task_completed_at", type: "Impossible task state transition", affected: impossible, severity: "High", logic: "Start precedes view, completion precedes start, or Completed status has no completion timestamp.", suggestion: "Review lifecycle evidence and event sequencing.", prevention: "Enforce ordered lifecycle transitions with explicit terminal states." });
      }
    });
    if (sessionCheck?.mismatched) {
      findings.push({
        id: "session_event_count_mismatch",
        dataset: sessionCheck.dataset,
        field: "events_in_session",
        type: "Session summary disagrees with event log",
        affected: sessionCheck.mismatched,
        severity: "High",
        logic: `events_in_session differs from Feature Events matched on session_id for ${sessionCheck.mismatched} of ${sessionCheck.total} sessions.`,
        suggestion: "Use event-grain Feature Events for event counts; verify how the session summary is generated.",
        prevention: "Reconcile aggregate counts against the event log during pipeline validation.",
      });
    }
    return findings;
  }

  function primaryKeyFields(dataset) {
    const identity = `${dataset.sheetName || ""} ${dataset.id}`.toLocaleLowerCase();
    if (/01_users_1000|users_1000_clean|users_messy_audit/.test(identity)) return ["user_id"];
    if (/02_sessions/.test(identity)) return ["session_id"];
    if (/03_feature_events|10_event_data_quality_audit/.test(identity)) return ["event_id"];
    if (/04_daily_activity/.test(identity)) return ["user_id", "activity_date"];
    if (/05_task_activity/.test(identity)) return ["activity_id"];
    if (/06_milestones/.test(identity)) return ["user_id", "milestone_type", "milestone_datetime"];
    if (/07_feature_usage/.test(identity)) return ["feature_name"];
    return [];
  }

  function sessionEventSummary(datasets) {
    const sessionDataset = byColumns(datasets, ["session_id", "events_in_session"], /02_Sessions/i);
    const eventDataset = byColumns(datasets, ["event_id", "session_id"], /03_Feature_Events/i);
    if (!sessionDataset || !eventDataset) return null;
    const sessionIndex = sessionDataset.columns.indexOf("session_id");
    const summaryIndex = sessionDataset.columns.indexOf("events_in_session");
    const eventSessionIndex = eventDataset.columns.indexOf("session_id");
    const eventCounts = new Map();
    eventDataset.rows.forEach((row) => {
      const sessionId = row[eventSessionIndex];
      if (!missing(sessionId)) eventCounts.set(String(sessionId), (eventCounts.get(String(sessionId)) || 0) + 1);
    });
    const mismatched = sessionDataset.rows.filter((row) => {
      const actual = Number(row[summaryIndex]);
      const observed = eventCounts.get(String(row[sessionIndex])) || 0;
      return !Number.isFinite(actual) || actual !== observed;
    }).length;
    return { dataset: sessionDataset.id, total: sessionDataset.rows.length, mismatched };
  }

  function relationships(datasets) {
    const users = byColumns(datasets, ["user_id"], /01_Users_1000|Users_1000_Clean/i);
    const sessions = byColumns(datasets, ["session_id"], /02_Sessions/i);
    if (!users) return [];
    const userIds = unique(users.rows.map((row) => row[users.columns.indexOf("user_id")]));
    const sessionIds = sessions ? unique(sessions.rows.map((row) => row[sessions.columns.indexOf("session_id")])) : new Set();
    const rows = [];
    datasets.filter((dataset) => dataset !== users && !/quality.?audit|messy.?audit/i.test(dataset.id)).forEach((dataset) => {
      for (const [field, target, key] of [["user_id", users, userIds], ["session_id", sessions, sessionIds]]) {
        if (!target || dataset === target || !dataset.columns.includes(field)) continue;
        const values = dataset.rows.map((row) => row[dataset.columns.indexOf(field)]).filter((value) => !missing(value));
        const matched = values.filter((value) => key.has(String(value))).length;
        const targetValues = target.rows.map((row) => row[target.columns.indexOf(field)]).filter((value) => !missing(value));
        const duplicateReferenceKeys = targetValues.length - unique(targetValues).size;
        const duplicateSourceKeys = values.length - unique(values).size;
        const cardinality = duplicateReferenceKeys && duplicateSourceKeys
          ? "Many-to-many candidate"
          : duplicateReferenceKeys
            ? "One-to-many candidate"
            : duplicateSourceKeys
              ? "Many-to-one candidate"
              : "One-to-one candidate";
        rows.push({ dataset: dataset.id, field, reference: target.id, referenceKey: field, sourceRows: values.length, matchedRows: matched, orphanRows: values.length - matched, matchRate: values.length ? round(matched / values.length * 100, 2) : null, cardinality, duplicateReferenceKeys, duplicateSourceKeys, evidence: "Identifier role, candidate entity, key uniqueness and observed value overlap checked; candidate only." });
      }
    });
    return rows;
  }

  function buildDictionary(datasets, dictionaryDataset) {
    const definitions = new Map();
    objects(dictionaryDataset).forEach((row) => {
      const datasetName = cleanId(row.dataset);
      const field = cleanId(row.field_name);
      definitions.set(`${datasetName}|${field}`, row);
      definitions.set(`|${field}`, row);
    });
    return datasets.flatMap((dataset) => dataset.columns.map((field, index) => {
      const sheetEntity = String(dataset.sheetName || "").replace(/^\d+_/, "").replace(/_1000$/i, "");
      const match = definitions.get(`${cleanId(sheetEntity)}|${cleanId(field)}`) || definitions.get(`${cleanId(dataset.id)}|${cleanId(field)}`) || definitions.get(`|${cleanId(field)}`);
      const values = dataset.rows.map((row) => row[index]).filter((value) => !missing(value));
      const distinct = unique(values);
      const sensitive = /email|name|phone|mobile|address|dob|birth|referral_code/i.test(field);
      const allowed = !sensitive && distinct.size > 1 && distinct.size <= 20 ? Array.from(distinct).slice(0, 20).join(", ") : "";
      return {
        dataset: dataset.id,
        field,
        type: dataset.profile[index]?.dtype || "unknown",
        definition: match?.definition || "Observed in supplied dataset; no definition in the supplied dictionary.",
        example: sensitive ? "[REDACTED]" : (values.length ? String(values[0]) : ""),
        required: match?.requirement || "Not specified",
        allowed: allowed || "Not documented",
        validation: match?.validation || "Proposed: validate type and nullability after business confirmation.",
        source: dataset.sourceName,
        sensitivity: sensitive ? "Potentially sensitive" : "No direct identifier detected",
        analyticalUse: match?.analytical_use || "Confirm analytical meaning with the data owner.",
        status: match?.definition ? "Confirmed in supplied dictionary" : "Observed field — definition proposed",
      };
    }));
  }

  window.VeloopProductAnalytics = { calculate, KPI_DEFINITIONS, dateValue, dayValue, retention, cohortTable, relationships, buildDictionary, qualityFindings };
})();
