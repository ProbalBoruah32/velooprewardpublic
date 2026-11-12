(() => {
  "use strict";

  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const MAX_TOTAL_UPLOAD_BYTES = 100 * 1024 * 1024;
  const SENSITIVE_NAMES = new Set([
    "address", "dateofbirth", "dob", "email", "emailaddress", "firstname",
    "fullname", "lastname", "mobile", "name", "phonenumber", "telephone",
  ]);
  const PAGE_COPY = {
    Overview: ["DATA WORKSPACE", "Key dataset indicators and current data-quality signals."],
    Analytics: ["EXPLORE DATA", "Inspect distributions from a selected dataset."],
    Datasets: ["SOURCE INVENTORY", "Review uploaded files, workbook sheets, schemas, and sample rows."],
    "Data Quality": ["DATA TRUST", "Review completeness and duplicate-row observations without altering source data."],
    Relationships: ["DATA MODEL", "Review possible identifier matches before approving any join."],
    "KPI Catalogue": ["BUSINESS DEFINITIONS", "No business metric is calculated without an approved definition."],
    Reports: ["AUDIT OUTPUTS", "Generate a privacy-conscious workbook from the current browser session."],
    Settings: ["WORKSPACE", "Understand the data classification and local processing boundary."],
  };

  const state = { datasets: [], currentPage: "Overview", toastTimer: null };
  const elements = {
    fileInput: document.querySelector("#file-input"),
    emptyState: document.querySelector("#empty-state"),
    dataView: document.querySelector("#data-view"),
    title: document.querySelector("#page-title"),
    description: document.querySelector("#page-description"),
    eyebrow: document.querySelector("#page-eyebrow"),
    metricGrid: document.querySelector("#metric-grid"),
    inventoryBody: document.querySelector("#inventory-body"),
    datasetCount: document.querySelector("#dataset-count"),
    globalSearch: document.querySelector("#global-search"),
    recordsChart: document.querySelector("#records-chart"),
    missingChart: document.querySelector("#missing-chart"),
    missingDatasetSelect: document.querySelector("#missing-dataset-select"),
    analyticsDatasetSelect: document.querySelector("#analytics-dataset-select"),
    analyticsFieldSelect: document.querySelector("#analytics-field-select"),
    analyticsChart: document.querySelector("#analytics-chart"),
    analyticsTitle: document.querySelector("#analytics-title"),
    profileBody: document.querySelector("#profile-body"),
    qualityDatasetSelect: document.querySelector("#quality-dataset-select"),
    qualityBody: document.querySelector("#quality-body"),
    qualitySummary: document.querySelector("#quality-summary"),
    relationshipsBody: document.querySelector("#relationships-body"),
    downloadReport: document.querySelector("#download-report"),
    toast: document.querySelector("#toast"),
    sidebar: document.querySelector("#sidebar"),
  };

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

  const normalizeName = (value) => String(value).toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  const isSensitive = (column) => SENSITIVE_NAMES.has(normalizeName(column));
  const isMissing = (value) => value === null || value === undefined || (typeof value === "string" && value.trim() === "");
  const valueKey = (value) => value instanceof Date ? value.toISOString() : `${typeof value}:${String(value)}`;
  const formatNumber = (value) => new Intl.NumberFormat().format(value);
  const safeSheetName = (name, used) => {
    const base = (name.replace(/[\\/*?:\[\]]/g, "_").replace(/^'+|'+$/g, "") || "Dataset").slice(0, 31);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase())) {
      const ending = `_${suffix++}`;
      candidate = `${base.slice(0, 31 - ending.length)}${ending}`;
    }
    used.add(candidate.toLocaleLowerCase());
    return candidate;
  };

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.remove("hidden");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => elements.toast.classList.add("hidden"), 4200);
  }

  function setPage(pageName) {
    if (!PAGE_COPY[pageName]) return;
    state.currentPage = pageName;
    document.querySelectorAll(".nav-item").forEach((button) => {
      const active = button.dataset.page === pageName;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    elements.title.textContent = pageName;
    elements.eyebrow.textContent = PAGE_COPY[pageName][0];
    elements.description.textContent = PAGE_COPY[pageName][1];
    document.querySelectorAll(".page-panel").forEach((panel) => panel.classList.add("hidden"));
    document.querySelector("#overview-visuals").classList.toggle("hidden", pageName !== "Overview");
    document.querySelector("#inventory-panel").classList.toggle("hidden", !["Overview", "Datasets"].includes(pageName));
    const panelByPage = {
      Analytics: "analytics-panel",
      Datasets: "datasets-panel",
      "Data Quality": "quality-panel",
      Relationships: "relationships-panel",
      "KPI Catalogue": "kpi-panel",
      Reports: "reports-panel",
      Settings: "settings-panel",
    };
    if (pageName === "Datasets") renderDatasetPreview();
    const panel = panelByPage[pageName];
    if (panel) document.getElementById(panel).classList.remove("hidden");
    if (state.datasets.length && pageName === "Analytics") renderAnalytics();
    elements.sidebar.classList.remove("open");
  }

  async function handleFiles(fileList) {
    if (!fileList?.length) return;
    if (!window.XLSX) {
      showToast("Excel/CSV parser did not load. Check the connection and reload the page.");
      return;
    }
    const accepted = Array.from(fileList);
    const rejected = accepted.filter((file) => file.size > MAX_FILE_BYTES);
    if (rejected.length) showToast(`${rejected.length} file${rejected.length === 1 ? "" : "s"} exceeded the 50 MB per-file limit and were skipped.`);

    const datasets = [];
    let acceptedBytes = 0;
    const withinLimits = accepted.filter((file) => {
      if (file.size > MAX_FILE_BYTES) return false;
      if (acceptedBytes + file.size > MAX_TOTAL_UPLOAD_BYTES) {
        showToast("The 100 MB total workspace limit was reached; remaining files were skipped.");
        return false;
      }
      acceptedBytes += file.size;
      return true;
    });
    for (const file of withinLimits) {
      try {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true, dense: true });
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false });
          const parsed = matrixToDataset(matrix, file.name, sheetName, file.name.toLocaleLowerCase().endsWith(".csv"));
          if (parsed) datasets.push(parsed);
        }
      } catch (error) {
        showToast(`Could not read ${file.name}: ${error instanceof Error ? error.message : "invalid file"}`);
      }
    }

    state.datasets = datasets;
    if (!datasets.length) {
      renderEmpty();
      showToast("No readable datasets were found in the selected files.");
      return;
    }
    document.querySelector("#empty-state").classList.add("hidden");
    elements.dataView.classList.remove("hidden");
    populateSelects();
    renderAll();
    showToast(`Loaded ${datasets.length} dataset${datasets.length === 1 ? "" : "s"}. Files remain in this browser.`);
  }

  function matrixToDataset(matrix, sourceName, sheetName, csv) {
    const nonBlankRows = matrix.filter((row) => row.some((value) => !isMissing(value)));
    if (nonBlankRows.length < 1) return null;
    const headerRow = nonBlankRows[0];
    const columns = [];
    const seen = new Map();
    headerRow.forEach((value, index) => {
      const original = isMissing(value) ? `column_${index + 1}` : String(value).trim();
      const count = (seen.get(original.toLocaleLowerCase()) || 0) + 1;
      seen.set(original.toLocaleLowerCase(), count);
      columns.push(count === 1 ? original : `${original}_${count}`);
    });
    if (!columns.length) return null;
    const rows = nonBlankRows.slice(1).map((row) => columns.map((_, index) => row[index] ?? null));
    return {
      id: `${sourceName} / ${csv ? "CSV" : sheetName}`,
      sourceName,
      sheetName: csv ? "CSV" : sheetName,
      columns,
      rows,
      profile: null,
      duplicateRows: 0,
    };
  }

  function profileDataset(dataset) {
    if (dataset.profile) return dataset.profile;
    const duplicateGroups = new Map();
    for (const row of dataset.rows) {
      const key = JSON.stringify(row.map((value) => value instanceof Date ? value.toISOString() : value));
      duplicateGroups.set(key, (duplicateGroups.get(key) || 0) + 1);
    }
    dataset.duplicateRows = dataset.rows.reduce((total, row) => {
      const key = JSON.stringify(row.map((value) => value instanceof Date ? value.toISOString() : value));
      return total + (duplicateGroups.get(key) > 1 ? 1 : 0);
    }, 0);
    dataset.profile = dataset.columns.map((column, columnIndex) => {
      const values = dataset.rows.map((row) => row[columnIndex]);
      const present = values.filter((value) => !isMissing(value));
      const distinct = new Set(present.map(valueKey));
      const numericValues = present.map((value) => typeof value === "number" ? value : (String(value).trim() !== "" ? Number(value) : NaN)).filter(Number.isFinite);
      const numeric = present.length > 0 && numericValues.length === present.length;
      const dateHint = /date|time|timestamp/i.test(column);
      const dates = dateHint ? present.map(parseDate).filter((value) => value !== null) : [];
      const dateInvalid = dateHint ? present.length - dates.length : 0;
      const missingCount = values.length - present.length;
      const frequencies = new Map();
      if (!isSensitive(column)) {
        for (const value of present) {
          const key = String(value);
          frequencies.set(key, (frequencies.get(key) || 0) + 1);
        }
      }
      const topValues = Array.from(frequencies.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const sorted = numericValues.slice().sort((a, b) => a - b);
      return {
        column,
        dtype: inferType(present, numeric, dateHint, dates),
        nonNullCount: present.length,
        missingCount,
        missingPct: values.length ? Number((missingCount / values.length * 100).toFixed(2)) : 0,
        uniqueCount: distinct.size,
        uniqueRatio: present.length ? Number((distinct.size / present.length).toFixed(4)) : 0,
        constant: present.length > 0 && distinct.size === 1,
        highCardinality: distinct.size >= 50 && distinct.size / Math.max(present.length, 1) >= 0.9,
        min: numeric && sorted.length ? sorted[0] : null,
        max: numeric && sorted.length ? sorted[sorted.length - 1] : null,
        mean: numeric && sorted.length ? numericValues.reduce((sum, value) => sum + value, 0) / sorted.length : null,
        median: numeric && sorted.length ? quantile(sorted, 0.5) : null,
        std: numeric && sorted.length ? standardDeviation(numericValues) : null,
        outlierCount: numeric && sorted.length ? countOutliers(sorted, numericValues) : 0,
        dateMin: dates.length ? new Date(dates.reduce((minimum, value) => Math.min(minimum, value), Infinity)).toISOString() : "",
        dateMax: dates.length ? new Date(dates.reduce((maximum, value) => Math.max(maximum, value), -Infinity)).toISOString() : "",
        dateInvalid,
        topValues,
        sensitive: isSensitive(column),
      };
    });
    return dataset.profile;
  }

  function inferType(values, numeric, dateHint, dates) {
    if (!values.length) return "empty";
    if (values.every((value) => typeof value === "boolean")) return "boolean";
    if (numeric) return values.every((value) => Number.isInteger(Number(value))) ? "integer" : "number";
    if (dateHint && dates.length) return "datetime";
    return "string/category";
  }

  function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
    if (typeof value === "number" && value > 10000 && value < 100000) {
      const date = XLSX.SSF.parse_date_code(value);
      if (date) return Date.UTC(date.y, date.m - 1, date.d, date.H, date.M, date.S);
    }
    const time = Date.parse(String(value));
    return Number.isNaN(time) ? null : time;
  }

  function quantile(sortedValues, fraction) {
    const position = (sortedValues.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
  }

  function standardDeviation(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  }

  function countOutliers(sorted, values) {
    if (sorted.length < 4) return 0;
    const lower = quantile(sorted, 0.25);
    const upper = quantile(sorted, 0.75);
    const spread = upper - lower;
    return values.filter((value) => value < lower - 1.5 * spread || value > upper + 1.5 * spread).length;
  }

  function populateSelects() {
    const selects = [elements.missingDatasetSelect, elements.analyticsDatasetSelect, elements.qualityDatasetSelect];
    for (const select of selects) {
      const previous = select.value;
      select.replaceChildren(...state.datasets.map((dataset) => new Option(dataset.id, dataset.id)));
      if (state.datasets.some((dataset) => dataset.id === previous)) select.value = previous;
    }
    refreshAnalyticsFields();
  }

  function selectedDataset(id) {
    return state.datasets.find((dataset) => dataset.id === id) || state.datasets[0];
  }

  function renderAll() {
    state.datasets.forEach(profileDataset);
    renderMetrics();
    renderInventory();
    renderOverviewCharts();
    renderProfile();
    renderQuality();
    renderRelationships();
    renderAnalytics();
    renderDatasetPreview();
    renderPageContent();
  }

  function renderMetrics() {
    const totalRows = state.datasets.reduce((sum, dataset) => sum + dataset.rows.length, 0);
    const missing = state.datasets.reduce((sum, dataset) => sum + dataset.profile.reduce((inner, column) => inner + column.missingCount, 0), 0);
    const duplicateRows = state.datasets.reduce((sum, dataset) => sum + dataset.duplicateRows, 0);
    const metrics = [
      ["Datasets", formatNumber(state.datasets.length), "Files and workbook sheets"],
      ["Records", formatNumber(totalRows), "Across current workspace"],
      ["Missing cells", formatNumber(missing), "Review context before treating as error"],
      ["Duplicate rows", formatNumber(duplicateRows), "Rows in exact duplicate groups"],
    ];
    elements.metricGrid.innerHTML = metrics.map(([label, value, note], index) => `<article class="metric-card ${index === 3 && duplicateRows ? "alert" : ""}"><div class="metric-label">${label}<span class="metric-info" title="${escapeHtml(note)}">i</span></div><div class="metric-value">${value}</div><div class="metric-foot">${escapeHtml(note)}</div></article>`).join("");
  }

  function renderInventory() {
    const query = elements.globalSearch.value.trim().toLocaleLowerCase();
    const visible = state.datasets.filter((dataset) => `${dataset.id} ${dataset.sourceName} ${dataset.sheetName}`.toLocaleLowerCase().includes(query));
    elements.datasetCount.textContent = `${visible.length} SHOWN`;
    elements.inventoryBody.innerHTML = visible.length ? visible.map((dataset) => `<tr data-dataset="${escapeHtml(dataset.id)}"><td>${escapeHtml(dataset.id)}</td><td>${escapeHtml(dataset.sourceName)}</td><td>${escapeHtml(dataset.sheetName)}</td><td>${formatNumber(dataset.rows.length)}</td><td>${formatNumber(dataset.columns.length)}</td><td>${formatNumber(dataset.duplicateRows)}</td></tr>`).join("") : `<tr><td class="empty-row" colspan="6">No datasets match this search.</td></tr>`;
    elements.inventoryBody.querySelectorAll("tr[data-dataset]").forEach((row) => row.addEventListener("click", () => {
      elements.analyticsDatasetSelect.value = row.dataset.dataset;
      elements.missingDatasetSelect.value = row.dataset.dataset;
      refreshAnalyticsFields();
      renderOverviewCharts();
      renderProfile();
      setPage("Analytics");
    }));
  }

  function plotLayout(extra = {}) {
    return {
      autosize: true,
      margin: { l: 42, r: 12, t: 12, b: 55 },
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      font: { family: "DM Sans, sans-serif", color: "#71807e", size: 10 },
      xaxis: { gridcolor: "#edf1ef", zerolinecolor: "#dfe7e3", automargin: true },
      yaxis: { gridcolor: "#edf1ef", zerolinecolor: "#dfe7e3", automargin: true },
      showlegend: false,
      ...extra,
    };
  }

  function renderOverviewCharts() {
    if (!window.Plotly || !state.datasets.length) return;
    const ordered = state.datasets.slice().sort((a, b) => b.rows.length - a.rows.length);
    Plotly.react(elements.recordsChart, [{
      type: "bar", x: ordered.map((dataset) => dataset.id), y: ordered.map((dataset) => dataset.rows.length),
      marker: { color: "#087f75", cornerradius: 3 },
      hovertemplate: "%{x}<br>%{y:,} records<extra></extra>",
    }], plotLayout({ margin: { l: 45, r: 12, t: 12, b: 90 }, xaxis: { tickangle: -30, gridcolor: "#fff", automargin: true }, yaxis: { title: "Records", gridcolor: "#edf1ef", automargin: true } }), { displayModeBar: false, responsive: true });
    const dataset = selectedDataset(elements.missingDatasetSelect.value);
    const missing = dataset.profile.filter((column) => column.missingCount > 0).sort((a, b) => a.missingPct - b.missingPct);
    if (!missing.length) {
      Plotly.purge(elements.missingChart);
      elements.missingChart.innerHTML = `<div class="chart-empty">No missing values in ${escapeHtml(dataset.id)}.</div>`;
      return;
    }
    Plotly.react(elements.missingChart, [{
      type: "bar", orientation: "h", x: missing.map((column) => column.missingPct), y: missing.map((column) => column.column),
      marker: { color: "#50ac9c" }, hovertemplate: "%{y}<br>%{x:.2f}% missing<extra></extra>",
    }], plotLayout({ margin: { l: 130, r: 18, t: 12, b: 34 }, xaxis: { title: "Missing (%)", range: [0, Math.min(100, Math.max(...missing.map((column) => column.missingPct)) * 1.18)], gridcolor: "#edf1ef" }, yaxis: { gridcolor: "#fff", automargin: true } }), { displayModeBar: false, responsive: true });
  }

  function renderProfile() {
    const dataset = selectedDataset(elements.analyticsDatasetSelect.value);
    if (!dataset) return;
    elements.profileBody.innerHTML = dataset.profile.map((column) => `<tr><td>${escapeHtml(column.column)}${column.sensitive ? " <span class=\"sensitive-tag\">SENSITIVE</span>" : ""}</td><td>${escapeHtml(column.dtype)}</td><td>${formatNumber(column.missingCount)} <span class="subtle">(${column.missingPct}%)</span></td><td>${formatNumber(column.uniqueCount)}</td><td>${formatMaybe(column.min)}</td><td>${formatMaybe(column.mean)}</td><td>${formatMaybe(column.median)}</td><td>${formatMaybe(column.max)}</td></tr>`).join("");
  }

  function formatMaybe(value) {
    if (value === null || value === undefined || value === "") return "—";
    return typeof value === "number" ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value) : escapeHtml(value);
  }

  function renderQuality() {
    const dataset = selectedDataset(elements.qualityDatasetSelect.value);
    if (!dataset) return;
    const observations = dataset.profile.filter((column) => column.missingCount > 0);
    const findings = [];
    if (!dataset.rows.length) findings.push({ check: "Empty dataset", status: "FAIL", severity: "HIGH", column: "", affected: 0, message: "Dataset contains headers but no records." });
    for (const column of observations) findings.push({ check: "Missing values", status: "OBSERVATION", severity: "INFO", column: column.column, affected: column.missingCount, message: `${column.missingPct}% missing; confirm expected nullability.` });
    if (dataset.duplicateRows) findings.push({ check: "Duplicate rows", status: "FAIL", severity: "MEDIUM", column: "", affected: dataset.duplicateRows, message: "Rows participating in exact duplicate groups." });
    const failCount = findings.filter((finding) => finding.status === "FAIL").length;
    const obsCount = findings.filter((finding) => finding.status === "OBSERVATION").length;
    elements.qualitySummary.innerHTML = `<div class="quality-stat"><span>Failed checks</span><strong>${formatNumber(failCount)}</strong></div><div class="quality-stat"><span>Observations</span><strong>${formatNumber(obsCount)}</strong></div><div class="quality-stat"><span>Not evaluated</span><strong>0 configured</strong></div>`;
    elements.qualityBody.innerHTML = findings.length ? findings.map((finding) => `<tr><td>${escapeHtml(finding.check)}</td><td><span class="status-chip ${finding.status === "FAIL" ? "status-fail" : "status-observation"}">${finding.status}</span></td><td>${finding.severity}</td><td>${escapeHtml(finding.column || "—")}</td><td>${formatNumber(finding.affected)}</td><td>${escapeHtml(finding.message)}</td></tr>`).join("") : `<tr><td colspan="6" class="empty-row">No missingness or exact duplicate findings for this dataset.</td></tr>`;
  }

  function renderRelationships() {
    const fieldMap = state.datasets.map((dataset) => ({
      dataset,
      columns: dataset.columns.filter((column) => /(^|_)(id|key)$|_id$/i.test(column) && !isSensitive(column)),
    }));
    const rows = [];
    for (let leftIndex = 0; leftIndex < fieldMap.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < fieldMap.length; rightIndex += 1) {
        for (const leftColumn of fieldMap[leftIndex].columns) {
          for (const rightColumn of fieldMap[rightIndex].columns) {
            if (normalizeName(leftColumn) !== normalizeName(rightColumn)) continue;
            const left = fieldMap[leftIndex].dataset;
            const right = fieldMap[rightIndex].dataset;
            const reference = new Set(right.rows.map((row) => valueKey(row[right.columns.indexOf(rightColumn)])).filter((key) => !key.endsWith(":null") && !key.endsWith(":undefined")));
            const sourceIndex = left.columns.indexOf(leftColumn);
            const values = left.rows.map((row) => row[sourceIndex]).filter((value) => !isMissing(value));
            const matches = values.filter((value) => reference.has(valueKey(value))).length;
            rows.push({ left, leftColumn, right, rightColumn, sourceCount: values.length, rate: values.length ? matches / values.length * 100 : 0 });
          }
        }
      }
    }
    elements.relationshipsBody.innerHTML = rows.length ? rows.slice(0, 250).map((row) => `<tr><td>${escapeHtml(row.left.id)}</td><td>${escapeHtml(row.leftColumn)}</td><td>${escapeHtml(row.right.id)}</td><td>${escapeHtml(row.rightColumn)}</td><td>${formatNumber(row.sourceCount)}</td><td>${row.rate.toFixed(1)}%</td></tr>`).join("") : `<tr><td colspan="6" class="empty-row">No matching identifier-like column names found.</td></tr>`;
  }

  function refreshAnalyticsFields() {
    const dataset = selectedDataset(elements.analyticsDatasetSelect.value);
    if (!dataset) return;
    const previous = elements.analyticsFieldSelect.value;
    elements.analyticsFieldSelect.replaceChildren(...dataset.columns.map((column) => new Option(column, column)));
    if (dataset.columns.includes(previous)) elements.analyticsFieldSelect.value = previous;
  }

  function renderAnalytics() {
    if (!window.Plotly || !state.datasets.length) return;
    const dataset = selectedDataset(elements.analyticsDatasetSelect.value);
    if (!dataset) return;
    const field = elements.analyticsFieldSelect.value || dataset.columns[0];
    const columnIndex = dataset.columns.indexOf(field);
    const profile = dataset.profile[columnIndex];
    if (!profile) return;
    elements.analyticsTitle.textContent = `${field} distribution`;
    let trace;
    let layout;
    if (profile.dtype === "integer" || profile.dtype === "number") {
      const values = dataset.rows.map((row) => Number(row[columnIndex])).filter(Number.isFinite);
      trace = [{ type: "histogram", x: values, nbinsx: 30, marker: { color: "#087f75" }, hovertemplate: "%{x}<br>%{y} records<extra></extra>" }];
      layout = plotLayout({ xaxis: { title: field, gridcolor: "#edf1ef" }, yaxis: { title: "Records", gridcolor: "#edf1ef" } });
    } else {
      const counts = new Map();
      for (const row of dataset.rows) {
        const value = isMissing(row[columnIndex]) ? "(missing)" : String(row[columnIndex]);
        counts.set(value, (counts.get(value) || 0) + 1);
      }
      const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25).reverse();
      trace = [{ type: "bar", orientation: "h", x: top.map((entry) => entry[1]), y: top.map((entry) => entry[0]), marker: { color: "#087f75" }, hovertemplate: "%{y}<br>%{x} records<extra></extra>" }];
      layout = plotLayout({ margin: { l: 150, r: 15, t: 10, b: 35 }, xaxis: { title: "Records", gridcolor: "#edf1ef" }, yaxis: { gridcolor: "#fff", automargin: true } });
    }
    Plotly.react(elements.analyticsChart, trace, layout, { displayModeBar: false, responsive: true });
    renderProfile();
  }

  function renderDatasetPreview() {
    let panel = document.querySelector("#datasets-panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "page-panel hidden";
      panel.id = "datasets-panel";
      panel.innerHTML = `<article class="panel table-panel"><div class="panel-heading"><div><p class="panel-kicker">SELECTED SOURCE</p><h2 id="preview-dataset-title">Dataset preview</h2></div><select id="preview-dataset-select" class="compact-select" aria-label="Dataset preview"></select></div><p class="table-note" id="preview-privacy-note">Common direct-identifier columns are hidden from this preview.</p><div class="table-scroll"><table><thead id="preview-head"></thead><tbody id="preview-body"></tbody></table></div></article>`;
      elements.dataView.append(panel);
    }
    if (!state.datasets.length) return;
    const select = document.querySelector("#preview-dataset-select");
    if (select.options.length !== state.datasets.length) {
      const previous = select.value;
      select.replaceChildren(...state.datasets.map((dataset) => new Option(dataset.id, dataset.id)));
      if (state.datasets.some((dataset) => dataset.id === previous)) select.value = previous;
      select.addEventListener("change", renderDatasetPreview);
    }
    const dataset = selectedDataset(select.value);
    const safeColumns = dataset.columns.map((column, index) => ({ column, index })).filter(({ column }) => !isSensitive(column));
    document.querySelector("#preview-dataset-title").textContent = dataset.id;
    document.querySelector("#preview-privacy-note").textContent = dataset.columns.some(isSensitive)
      ? `Hidden direct-identifier fields: ${dataset.columns.filter(isSensitive).join(", ")}. Source data remains in browser memory only.`
      : "Preview only. Source data remains in browser memory only.";
    document.querySelector("#preview-head").innerHTML = `<tr>${safeColumns.map(({ column }) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>`;
    document.querySelector("#preview-body").innerHTML = dataset.rows.slice(0, 100).map((row) => `<tr>${safeColumns.map(({ index }) => `<td>${escapeHtml(displayCell(row[index]))}</td>`).join("")}</tr>`).join("") || `<tr><td class="empty-row" colspan="${Math.max(safeColumns.length, 1)}">No rows to preview.</td></tr>`;
  }

  function displayCell(value) {
    if (value instanceof Date) return value.toISOString();
    return isMissing(value) ? "" : String(value);
  }

  function renderPageContent() {
    const domains = [
      ["Users and engagement", "Requires approved activity definition"],
      ["Tasks and conversion", "Requires validated lifecycle events"],
      ["Rewards and wallet", "No transaction ledger supplied"],
      ["Withdrawals", "No withdrawal records supplied"],
      ["Referrals", "Requires referral lifecycle and approved criteria"],
    ];
    document.querySelector("#domain-list").innerHTML = domains.map(([domain, status]) => `<div class="domain-item"><strong>${domain}</strong><span class="domain-status">${status}</span></div>`).join("");
  }

  function createReport() {
    if (!window.XLSX || !state.datasets.length) {
      showToast("Load a readable dataset before generating a workbook.");
      return;
    }
    const workbook = XLSX.utils.book_new();
    const usedNames = new Set();
    const inventory = state.datasets.map((dataset) => ({
      dataset: dataset.id,
      source_file: dataset.sourceName,
      sheet: dataset.sheetName,
      classification: "SIMULATED / USER-SUPPLIED",
      records: dataset.rows.length,
      columns: dataset.columns.length,
      duplicate_rows: dataset.duplicateRows,
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(inventory), safeSheetName("Inventory", usedNames));

    const profiles = state.datasets.flatMap((dataset) => dataset.profile.map((column) => ({
      dataset: dataset.id,
      column: column.column,
      dtype: column.dtype,
      non_null_count: column.nonNullCount,
      missing_count: column.missingCount,
      missing_pct: column.missingPct,
      unique_count: column.uniqueCount,
      unique_ratio: column.uniqueRatio,
      constant: column.constant,
      high_cardinality: column.highCardinality,
      numeric_min: column.min,
      numeric_mean: column.mean,
      numeric_median: column.median,
      numeric_max: column.max,
      numeric_std: column.std,
      outlier_count: column.outlierCount,
      date_min: column.dateMin,
      date_max: column.dateMax,
      invalid_date_count: column.dateInvalid,
      top_values: column.sensitive ? "" : column.topValues.map(([value, count]) => `${value}: ${count}`).join("; "),
      sensitive_field: column.sensitive,
    })));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(profiles), safeSheetName("Column Profile", usedNames));

    const quality = state.datasets.flatMap((dataset) => {
      const results = dataset.profile.filter((column) => column.missingCount > 0).map((column) => ({
        code: "missing_values", status: "OBSERVATION", severity: "INFO", dataset: dataset.id,
        column: column.column, affected_rows: column.missingCount,
        message: "Missing values found; review whether they are permitted.",
      }));
      if (dataset.duplicateRows) results.push({ code: "duplicate_rows", status: "FAIL", severity: "MEDIUM", dataset: dataset.id, column: "", affected_rows: dataset.duplicateRows, message: "Rows participating in exact duplicate groups were found." });
      return results;
    });
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(quality), safeSheetName("Quality Findings", usedNames));

    const privacyNotes = [];
    for (const dataset of state.datasets) {
      const excluded = dataset.columns.filter(isSensitive);
      for (const field of excluded) privacyNotes.push({ dataset: dataset.id, excluded_field: field, reason: "Direct-identifier field excluded from report output." });
      const safeIndexes = dataset.columns.map((column, index) => ({ column, index })).filter(({ column }) => !isSensitive(column));
      const safeRows = dataset.rows.map((row) => safeIndexes.map(({ index }) => excelSafe(row[index])));
      const sheet = XLSX.utils.aoa_to_sheet([safeIndexes.map(({ column }) => column), ...safeRows]);
      XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(dataset.id, usedNames));
    }
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(privacyNotes), safeSheetName("Privacy Notes", usedNames));

    const filename = `veloop_data_audit_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, filename, { compression: true });
    showToast("Audit workbook downloaded. Direct-identifier columns were excluded.");
  }

  function excelSafe(value) {
    if (typeof value === "string" && /^[\t\r\n ]*[=+\-@]/.test(value)) return `'${value}`;
    return value instanceof Date ? value.toISOString() : value;
  }

  function renderEmpty() {
    elements.dataView.classList.add("hidden");
    elements.emptyState.classList.remove("hidden");
  }

  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.page)));
  elements.fileInput.addEventListener("change", async (event) => {
    await handleFiles(event.target.files);
    event.target.value = "";
  });
  elements.globalSearch.addEventListener("input", renderInventory);
  elements.missingDatasetSelect.addEventListener("change", renderOverviewCharts);
  elements.analyticsDatasetSelect.addEventListener("change", () => { refreshAnalyticsFields(); renderAnalytics(); });
  elements.analyticsFieldSelect.addEventListener("change", renderAnalytics);
  elements.qualityDatasetSelect.addEventListener("change", renderQuality);
  elements.downloadReport.addEventListener("click", createReport);
  document.querySelector("#mobile-menu").addEventListener("click", () => elements.sidebar.classList.toggle("open"));
  window.addEventListener("resize", () => {
    if (state.datasets.length && window.Plotly) {
      [elements.recordsChart, elements.missingChart, elements.analyticsChart].forEach((chart) => {
        if (chart.data) Plotly.Plots.resize(chart);
      });
    }
  });

  setPage("Overview");
})();