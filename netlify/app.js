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
    "Executive Overview": ["EXECUTIVE ANALYTICS", "Evidence-based product metrics and dataset coverage from the current upload."],
    "Product Analytics": ["PRODUCT ANALYTICS", "Explore user, session, feature, task, retention, and milestone activity."],
    Analytics: ["EXPLORE DATA", "Inspect distributions from a selected dataset."],
    Datasets: ["SOURCE INVENTORY", "Review uploaded files, workbook sheets, schemas, and sample rows."],
    "Data Quality": ["DATA TRUST", "Review completeness and duplicate-row observations without altering source data."],
    Relationships: ["DATA MODEL", "Review possible identifier matches before approving any join."],
    "KPI Catalogue": ["KPI INTELLIGENCE", "Search 35 evidence-based KPIs and inspect calculations, sources, and limitations."],
    "Data Dictionary": ["SOURCE SCHEMA", "Search observed source fields and distinguish documented definitions from proposals."],
    Reports: ["AUDIT OUTPUTS", "Generate a privacy-conscious workbook from the current browser session."],
    Settings: ["WORKSPACE", "Understand the data classification and local processing boundary."],
  };

  const state = { datasets: [], currentPage: "Overview", toastTimer: null, analytics: null, duplicateFileCount: 0 };
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
      "Executive Overview": "executive-panel",
      "Product Analytics": "product-panel",
      "Data Dictionary": "dictionary-panel",
      Reports: "reports-panel",
      Settings: "settings-panel",
    };
    if (pageName === "Datasets") renderDatasetPreview();
    const panel = panelByPage[pageName];
    if (panel) document.getElementById(panel).classList.remove("hidden");
    if (state.datasets.length && pageName === "Analytics") renderAnalytics();
    if (state.datasets.length && ["Executive Overview", "Product Analytics", "KPI Catalogue", "Data Dictionary"].includes(pageName)) renderProductAnalytics();
    if (state.datasets.length && pageName === "Data Quality") renderQuality();
    if (state.datasets.length && pageName === "Relationships") renderRelationships();
    elements.sidebar.classList.remove("open");
  }

  function contentFingerprint(datasets) {
    let first = 0x811c9dc5;
    let second = 0x9747b28c;
    let length = 0;
    const absorb = (text) => {
      for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        first = Math.imul(first ^ code, 0x01000193) >>> 0;
        second = Math.imul(second ^ code, 0x5bd1e995) >>> 0;
        length += 1;
      }
      first = Math.imul(first ^ 255, 0x01000193) >>> 0;
      second = Math.imul(second ^ 255, 0x5bd1e995) >>> 0;
    };
    datasets.forEach((dataset) => {
      absorb(JSON.stringify([dataset.sheetName, dataset.columns, dataset.rows.length]));
      dataset.rows.forEach((row) => absorb(JSON.stringify(row)));
    });
    return `${first}:${second}:${length}:${datasets.length}`;
  }

  function sameWorkbookContents(left, right) {
    if (left.length !== right.length) return false;
    return left.every((dataset, index) => {
      const other = right[index];
      return dataset.sheetName === other.sheetName
        && JSON.stringify(dataset.columns) === JSON.stringify(other.columns)
        && dataset.rows.length === other.rows.length
        && dataset.rows.every((row, rowIndex) => JSON.stringify(row) === JSON.stringify(other.rows[rowIndex]));
    });
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
    const seenFileHashes = new Set();
    const seenContentHashes = new Map();
    let duplicateFiles = 0;
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
        const content = await file.arrayBuffer();
        if (window.crypto?.subtle) {
          const digest = await window.crypto.subtle.digest("SHA-256", content);
          const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
          if (seenFileHashes.has(fingerprint)) {
            duplicateFiles += 1;
            continue;
          }
          seenFileHashes.add(fingerprint);
        }
        const workbook = XLSX.read(content, { type: "array", cellDates: true, dense: true });
        const fileDatasets = [];
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false });
          const parsed = matrixToDataset(matrix, file.name, sheetName, file.name.toLocaleLowerCase().endsWith(".csv"));
          if (parsed) fileDatasets.push(parsed);
        }
        if (fileDatasets.length) {
          const fingerprint = contentFingerprint(fileDatasets);
          const candidates = seenContentHashes.get(fingerprint) || [];
          if (candidates.some((candidate) => sameWorkbookContents(candidate, fileDatasets))) {
            duplicateFiles += 1;
            continue;
          }
          candidates.push(fileDatasets);
          seenContentHashes.set(fingerprint, candidates);
          datasets.push(...fileDatasets);
        }
      } catch (error) {
        showToast(`Could not read ${file.name}: ${error instanceof Error ? error.message : "invalid file"}`);
      }
    }

    state.datasets = datasets;
    state.duplicateFileCount = duplicateFiles;
    ["product-date-start", "product-date-end", "product-date-start-secondary", "product-date-end-secondary"].forEach((id) => {
      document.querySelector(`#${id}`).value = "";
    });
    if (!datasets.length) {
      renderEmpty();
      showToast("No readable datasets were found in the selected files.");
      return;
    }
    document.querySelector("#empty-state").classList.add("hidden");
    elements.dataView.classList.remove("hidden");
    populateSelects();
    renderAll();
    const duplicateNote = duplicateFiles ? ` Skipped ${duplicateFiles} exact duplicate workbook${duplicateFiles === 1 ? "" : "s"}.` : "";
    showToast(`Loaded ${datasets.length} dataset${datasets.length === 1 ? "" : "s"}.${duplicateNote} Files remain in this browser.`);
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
    renderAnalytics();
    renderDatasetPreview();
    renderProductAnalytics();
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
    const findings = (state.analytics?.quality || []).filter((finding) => finding.dataset === dataset.id);
    if (!dataset.rows.length) findings.push({ id: "empty_dataset", dataset: dataset.id, field: "", type: "Empty dataset", severity: "High", affected: 0, logic: "Dataset contains headers but no records.", suggestion: "Confirm the source export and record filters." });
    elements.qualitySummary.innerHTML = `<div class="quality-stat"><span>Issues found</span><strong>${formatNumber(findings.length)}</strong></div><div class="quality-stat"><span>High severity</span><strong>${formatNumber(findings.filter((finding) => finding.severity === "High").length)}</strong></div><div class="quality-stat"><span>Records affected</span><strong>${formatNumber(findings.reduce((sum, finding) => sum + finding.affected, 0))}</strong></div>`;
    elements.qualityBody.innerHTML = findings.length ? findings.map((finding) => `<tr><td>${escapeHtml(finding.id)}</td><td>${escapeHtml(finding.dataset)}</td><td>${escapeHtml(finding.field || "—")}</td><td>${escapeHtml(finding.type)}</td><td>${formatNumber(finding.affected)}</td><td>${escapeHtml(finding.severity)}</td><td>Needs review</td><td>${escapeHtml(finding.logic)}</td><td>${escapeHtml(`${finding.suggestion} ${finding.prevention || ""}`)}</td></tr>`).join("") : `<tr><td colspan="9" class="empty-row">No findings in this dataset with the available checks.</td></tr>`;
  }

  function renderRelationships() {
    const rows = state.analytics?.relationships || [];
    elements.relationshipsBody.innerHTML = rows.length ? rows.map((row) => `<tr><td>${escapeHtml(row.dataset)}</td><td>${escapeHtml(row.field)}</td><td>${escapeHtml(row.reference)}</td><td>${escapeHtml(row.cardinality)}</td><td>${formatNumber(row.sourceRows)}</td><td>${formatNumber(row.matchedRows)}</td><td>${formatNumber(row.orphanRows)}</td><td>${row.matchRate === null ? "—" : `${row.matchRate}%`}</td><td>${formatNumber(row.duplicateReferenceKeys)}</td><td>${escapeHtml(row.evidence)}</td></tr>`).join("") : `<tr><td colspan="10" class="empty-row">No validated candidate relationships can be tested from the loaded datasets.</td></tr>`;
    const nodeNames = Array.from(new Set(rows.flatMap((row) => [shortDatasetName(row.dataset), shortDatasetName(row.reference)])));
    const nodeIndex = new Map(nodeNames.map((name, index) => [name, index]));
    plotChart("relationship-diagram-chart", rows.length ? [{
      type: "sankey",
      arrangement: "snap",
      node: { label: nodeNames, pad: 18, thickness: 16, color: "#087f75", line: { color: "#dce9e3", width: 1 } },
      link: {
        source: rows.map((row) => nodeIndex.get(shortDatasetName(row.dataset))),
        target: rows.map((row) => nodeIndex.get(shortDatasetName(row.reference))),
        value: rows.map((row) => Math.max(row.matchedRows, 1)),
        label: rows.map((row) => `${row.field} · ${row.cardinality}`),
        customdata: rows.map((row) => `${row.matchedRows} matched / ${row.sourceRows} source rows; ${row.orphanRows} orphans`),
        hovertemplate: "%{label}<br>%{customdata}<extra></extra>",
        color: "rgba(8,127,117,0.28)",
      },
    }] : [], { margin: { l: 15, r: 15, t: 10, b: 10 } });
  }

  function shortDatasetName(datasetId) {
    const parts = String(datasetId).split("/");
    return parts[parts.length - 1].trim();
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
    if (!state.analytics) return;
    renderKpis(state.analytics);
    renderDictionary(state.analytics);
  }

  function productDates() {
    const start = document.querySelector("#product-date-start").value;
    const end = document.querySelector("#product-date-end").value;
    document.querySelector("#product-date-start-secondary").value = start;
    document.querySelector("#product-date-end-secondary").value = end;
    return { start, end };
  }

  function renderProductAnalytics() {
    if (!state.datasets.length || !window.VeloopProductAnalytics) return;
    const dates = productDates();
    state.analytics = window.VeloopProductAnalytics.calculate(state.datasets, dates.start, dates.end);
    const days = state.analytics.ranges.activityDays;
    const startInput = document.querySelector("#product-date-start");
    const endInput = document.querySelector("#product-date-end");
    if (days.length) {
      startInput.min = days[0];
      startInput.max = days[days.length - 1];
      endInput.min = days[0];
      endInput.max = days[days.length - 1];
      if (!startInput.value) startInput.value = days[0];
      if (!endInput.value) endInput.value = days[days.length - 1];
      document.querySelector("#product-observation-note").textContent = `Observed source window: ${days[0]} to ${days[days.length - 1]} · Data observed through ${state.analytics.latestActivityDate || "unknown"} · Profiled ${new Date().toLocaleString()}.`;
      if (startInput.value > endInput.value) endInput.value = startInput.value;
      if (startInput.value < days[0]) startInput.value = days[0];
      if (endInput.value > days[days.length - 1]) endInput.value = days[days.length - 1];
      dates.start = startInput.value;
      dates.end = endInput.value;
      document.querySelector("#product-date-start-secondary").value = dates.start;
      document.querySelector("#product-date-end-secondary").value = dates.end;
      state.analytics = window.VeloopProductAnalytics.calculate(state.datasets, dates.start, dates.end);
    } else {
      document.querySelector("#product-observation-note").textContent = "No valid activity_date values were observed; date-dependent metrics may be unavailable.";
    }
    renderExecutive(state.analytics, dates);
    renderProductModules(state.analytics);
    renderPageContent();
    renderQuality();
    renderRelationships();
  }

  function renderExecutive(model, dates) {
    const names = [
      "Total Registered Users", "Daily Active Users", "Monthly Active Users",
      "Average Session Duration", "Feature Adoption Rate", "Task Completion Rate",
      "Returning User Rate",
    ];
    const previousWindowDays = dates.start && dates.end
      ? Math.max(1, Math.round((Date.parse(`${dates.end}T00:00:00Z`) - Date.parse(`${dates.start}T00:00:00Z`)) / 86400000) + 1)
      : 0;
    let previous = null;
    if (previousWindowDays) {
      const previousEnd = new Date(Date.parse(`${dates.start}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
      const previousStart = new Date(Date.parse(`${previousEnd}T00:00:00Z`) - (previousWindowDays - 1) * 86400000).toISOString().slice(0, 10);
      previous = window.VeloopProductAnalytics.calculate(state.datasets, previousStart, previousEnd);
    }
    const metrics = names.map((name) => {
      const current = model.kpis.find((item) => item.name === name);
      const prior = previous?.kpis.find((item) => item.name === name);
      let note = current?.status || "Not Calculable";
      if (previous && current?.status === "Calculable" && prior?.status === "Calculable" && typeof current.value === "number" && typeof prior.value === "number") {
        const change = current.value - prior.value;
        note = `vs prior window ${change > 0 ? "+" : ""}${change.toFixed(2)}${name.includes("Rate") || name.includes("Adoption") ? " pp" : ""}`;
      } else if (previous && prior?.status !== "Calculable") {
        note = `${current?.status || "Not Calculable"} · prior window unavailable`;
      }
      return `<article class="metric-card"><div class="metric-label">${escapeHtml(name)}</div><div class="metric-value">${escapeHtml(formatMetric(name, current?.value))}</div><div class="metric-foot">${escapeHtml(note)}</div></article>`;
    });
    const sessions = model.rows.sessions.length;
    const events = model.rows.events.length;
    const activeUsers = new Set(model.rows.activity.map((row) => String(row.user_id)).filter((id) => !isMissing(id))).size;
    const previousActiveUsers = previous?.rows.activity.length ? new Set(previous.rows.activity.map((row) => String(row.user_id)).filter((id) => !isMissing(id))).size : null;
    const previousSessions = previous?.rows.sessions.length ? previous.rows.sessions.length : null;
    const previousEvents = previous?.rows.events.length ? previous.rows.events.length : null;
    const comparison = (current, prior) => typeof prior === "number"
      ? `vs prior window ${current - prior > 0 ? "+" : ""}${(current - prior).toFixed(0)}`
      : "Prior window unavailable";
    const totalCards = [
      ...metrics.slice(0, 3),
      metricCard("Active Users", activeUsers, comparison(activeUsers, previousActiveUsers)),
      metricCard("Total Sessions", sessions, comparison(sessions, previousSessions)),
      metrics[3],
      metricCard("Feature Events", events, comparison(events, previousEvents)),
      ...metrics.slice(4),
    ];
    document.querySelector("#executive-metrics").innerHTML = totalCards.join("");
    renderLineChart("executive-dau-chart", model.charts.activityByDay, "Active users");
    renderLineChart("executive-registration-chart", model.charts.registrationsByDay, "Registrations");

    document.querySelector("#coverage-body").innerHTML = buildCoverageRows(model).map((row) => `<tr><td>${escapeHtml(row.product_area)}</td><td>${escapeHtml(row.source_dataset)}</td><td>${row.record_count === null ? "—" : formatNumber(row.record_count)}</td><td>${escapeHtml(row.available_fields)}</td><td>${escapeHtml(row.missing_required_fields)}</td><td>${escapeHtml(row.proposed_events)}</td><td>${escapeHtml(row.kpi_dependencies)}</td><td><span class="status-chip ${row.readiness.startsWith("Available") || row.readiness === "Calculable" ? "status-ready" : "status-observation"}">${escapeHtml(row.readiness)}</span></td><td>${escapeHtml(`${row.priority}. ${row.data_note}`)}</td></tr>`).join("");
  }

  function buildCoverageRows(model) {
    const definitions = [
      { area: "User analytics", key: "users", fields: ["user_id", "registration_datetime", "verification_status", "account_status", "onboarding_status", "acquisition_source", "platform"], events: "user_registered; verification_status_changed; onboarding_completed (proposal)", kpis: ["Total Registered Users", "Verified User Rate", "Onboarding Completion Rate"], priority: "P1" },
      { area: "Engagement / retention", key: "activity", fields: ["user_id", "activity_date", "active_flag"], events: "No new event specified; validate qualifying active_flag semantics (proposal)", kpis: ["Daily Active Users", "Monthly Active Users", "Returning User Rate", "Day 1 Retention", "Day 7 Retention", "Day 30 Retention"], priority: "P1" },
      { area: "Session analytics", key: "sessions", fields: ["session_id", "user_id", "session_start", "session_end", "session_duration_seconds", "entry_point", "exit_feature"], events: "No new event specified; confirm session timestamp/device definitions", kpis: ["Average Sessions per User", "Average Session Duration", "Average Events per Session"], priority: "P1" },
      { area: "Feature analytics", key: "events", fields: ["event_id", "user_id", "session_id", "event_datetime", "feature_name", "event_status"], events: "No new event specified; confirm event taxonomy and status meanings", kpis: ["Feature Adoption Rate", "Feature Usage Frequency", "Feature Success Rate"], priority: "P1" },
      { area: "Task analytics", key: "tasks", fields: ["activity_id", "task_status", "task_viewed_at", "task_started_at", "task_completed_at"], events: "task_viewed; task_started; task_completed; task_failed (proposed event names)", kpis: ["Task Completion Rate", "Task Failure Rate", "Average Task Completion Time"], priority: "P1" },
      { area: "Milestone analytics", key: "milestones", fields: ["user_id", "milestone_type", "milestone_datetime"], events: "milestone_achieved with source event reference (proposal)", kpis: ["Total Milestones Achieved", "Milestone Frequency"], priority: "P2" },
    ];
    const rows = definitions.map((definition) => {
      const dataset = model.sources[definition.key];
      const available = dataset ? definition.fields.filter((field) => dataset.columns.includes(field)) : [];
      const missing = definition.fields.filter((field) => !dataset?.columns.includes(field));
      const qualityCount = dataset ? model.quality.filter((finding) => finding.dataset === dataset.id).length : 0;
      return {
        product_area: definition.area,
        source_dataset: dataset?.id || "Not supplied",
        record_count: dataset?.rows.length ?? null,
        available_fields: dataset ? `${available.length}/${definition.fields.length} required; ${dataset.columns.length} total in source` : "0 observed",
        missing_required_fields: missing.join(", ") || "None of listed fields",
        proposed_events: definition.events,
        kpi_dependencies: definition.kpis.join(", "),
        readiness: !dataset ? "Proposed – Data Required" : (missing.length ? "Partially Available" : "Available"),
        priority: definition.priority,
        data_note: dataset ? `${qualityCount} detected quality rule(s); field presence is not business approval.` : "Provide source before calculating.",
      };
    });
    const dictionary = model.sources.dictionary;
    rows.push({
      product_area: "Data dictionary",
      source_dataset: dictionary?.id || "Inferred from observed columns",
      record_count: model.dictionary.length,
      available_fields: `${model.dictionary.length} observed field definitions`,
      missing_required_fields: dictionary ? "Some observed fields lack source documentation" : "No source dictionary supplied",
      proposed_events: "No instrumentation event; document source fields and validation ownership",
      kpi_dependencies: "Field mappings and interpretation",
      readiness: model.dictionary.length ? "Partially Available" : "Proposed – Data Required",
      priority: "P2",
      data_note: `${model.dictionary.filter((row) => row.status === "Confirmed in supplied dictionary").length} definitions documented; rest are labelled proposed.`,
    });
    rows.push({
      product_area: "Data quality",
      source_dataset: `${state.datasets.length} uploaded datasets`,
      record_count: model.quality.length,
      available_fields: "Missingness, duplicates, date/category/numeric and key checks",
      missing_required_fields: "Rule coverage depends on confirmed schemas",
      proposed_events: "No instrumentation event; add approved field-level rules as requirements are confirmed",
      kpi_dependencies: "Quality validation",
      readiness: "Available — checks executed",
      priority: "P1",
      data_note: `${model.quality.length} findings; no source rows were modified.`,
    });
    rows.push({
      product_area: "Relationships",
      source_dataset: "Users / Sessions and candidate child datasets",
      record_count: model.relationships.length,
      available_fields: "Observed identifier candidates, key uniqueness, value overlap",
      missing_required_fields: "Business-owner confirmation of relation semantics",
      proposed_events: "No instrumentation event; confirm primary/foreign-key contracts",
      kpi_dependencies: "User/session joins and attribution",
      readiness: model.relationships.length ? "Partially Available" : "Proposed – Data Required",
      priority: "P1",
      data_note: "Candidate links only; joins are not executed.",
    });
    const calculable = model.kpis.filter((item) => item.status === "Calculable").length;
    const partial = model.kpis.filter((item) => item.status === "Partially Calculable").length;
    rows.push({
      product_area: "KPI readiness",
      source_dataset: "35 defined KPIs",
      record_count: model.kpis.length,
      available_fields: `${calculable} calculable; ${partial} partially calculable`,
      missing_required_fields: "Unavailable metrics list the required source area/fields",
      proposed_events: "No instrumentation event; add source data before claiming unavailable metrics",
      kpi_dependencies: "35 catalogued definitions",
      readiness: calculable ? "Partially Available" : "Not Calculable",
      priority: "P1",
      data_note: "Categorical status based on required data; no readiness percentage is inferred.",
    });
    return rows;
  }

  function metricCard(name, value, note) {
    return `<article class="metric-card"><div class="metric-label">${escapeHtml(name)}</div><div class="metric-value">${escapeHtml(formatMetric(name, value))}</div><div class="metric-foot">${escapeHtml(note)}</div></article>`;
  }

  function formatMetric(name, value) {
    if (value === null || value === undefined || value === "—" || value === "") return "—";
    if (typeof value !== "number") return String(value);
    const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
    if (/rate|adoption|retention/i.test(name)) return `${formatted}%`;
    if (/duration|completion time/i.test(name)) return `${formatted} sec`;
    return formatted;
  }

  function plotChart(id, traces, layout) {
    const element = document.getElementById(id);
    if (!element) return;
    if (!window.Plotly) {
      element.innerHTML = `<div class="chart-empty">Chart library unavailable. Check the connection and reload.</div>`;
      return;
    }
    if (!traces.length || traces.every((trace) => !(trace.x?.length || trace.labels?.length || trace.y?.length || trace.z?.length))) {
      Plotly.purge(element);
      element.innerHTML = `<div class="chart-empty">No supported records in this selection.</div>`;
      return;
    }
    Plotly.react(element, traces, plotLayout(layout), { displayModeBar: false, responsive: true });
  }

  function renderLineChart(id, points, axisTitle) {
    plotChart(id, points.length ? [{
      type: "scatter", mode: "lines+markers",
      x: points.map((point) => point.name), y: points.map((point) => point.count),
      line: { color: "#087f75", width: 2 }, marker: { color: "#087f75", size: 5 },
      hovertemplate: "%{x}<br>%{y:,}<extra></extra>",
    }] : [], { xaxis: { title: "", gridcolor: "#edf1ef" }, yaxis: { title: axisTitle, gridcolor: "#edf1ef" } });
  }

  function renderBarChart(id, points, axisTitle = "Records", horizontal = true) {
    const values = points.slice().sort((left, right) => left.count - right.count);
    plotChart(id, values.length ? [{
      type: "bar", orientation: horizontal ? "h" : "v",
      x: horizontal ? values.map((point) => point.count) : values.map((point) => point.name),
      y: horizontal ? values.map((point) => point.name) : values.map((point) => point.count),
      marker: { color: "#087f75" },
      hovertemplate: horizontal ? "%{y}<br>%{x:,}<extra></extra>" : "%{x}<br>%{y:,}<extra></extra>",
    }] : [], horizontal
      ? { margin: { l: 145, r: 12, t: 10, b: 35 }, xaxis: { title: axisTitle, gridcolor: "#edf1ef" }, yaxis: { gridcolor: "#fff", automargin: true } }
      : { xaxis: { tickangle: -30, automargin: true }, yaxis: { title: axisTitle, gridcolor: "#edf1ef" } });
  }

  function renderDonutChart(id, points) {
    plotChart(id, points.length ? [{
      type: "pie", hole: 0.62,
      labels: points.map((point) => point.name), values: points.map((point) => point.count),
      textinfo: "label+percent", marker: { colors: ["#087f75", "#52a99a", "#a9d8c8", "#e7bb72", "#bc7359", "#7787a0"] },
      hovertemplate: "%{label}<br>%{value:,} records<extra></extra>",
    }] : [], { showlegend: true, legend: { orientation: "h", y: -0.12 }, margin: { l: 12, r: 12, t: 10, b: 25 } });
  }

  function renderProductModules(model) {
    const charts = model.charts;
    renderDonutChart("user-status-chart", charts.userStatus);
    renderDonutChart("user-activity-chart", charts.activityStatus);
    renderDonutChart("user-verification-chart", charts.verification);
    renderDonutChart("user-onboarding-chart", charts.onboarding);
    renderBarChart("user-acquisition-chart", charts.acquisition);
    renderDonutChart("user-platform-chart", charts.platform);
    renderBarChart("user-geography-chart", charts.geography);
    renderLineChart("session-trend-chart", charts.sessionsByDay, "Sessions");
    renderDonutChart("session-status-chart", charts.sessionStatuses);
    renderBarChart("session-entry-chart", charts.sessionEntryPoints);
    renderBarChart("session-exit-chart", charts.sessionExitFeatures);
    renderDonutChart("session-platform-chart", charts.sessionPlatforms);
    renderDonutChart("session-device-chart", charts.sessionDevices);
    renderBarChart("feature-ranking-chart", charts.features);
    renderDonutChart("feature-status-chart", charts.eventStatuses);
    renderDonutChart("feature-platform-chart", charts.eventPlatforms);
    renderLineChart("milestone-trend-chart", charts.milestonesByDay, "Milestones");
    renderBarChart("task-status-chart", charts.taskStatuses);
    renderBarChart("task-category-chart", charts.taskCategories);
    renderLineChart("task-trend-chart", charts.tasksByDay, "Task views");
    renderBarChart("milestone-chart", charts.milestoneTypes);
    renderDonutChart("xp-chart", charts.xpEvents);

    const featureDataset = model.sources.events;
    const featureUsers = new Map();
    model.rows.events.forEach((row) => {
      if (!featureUsers.has(String(row.feature_name))) featureUsers.set(String(row.feature_name), new Set());
      if (!isMissing(row.user_id)) featureUsers.get(String(row.feature_name)).add(String(row.user_id));
    });
    const registered = model.kpis.find((item) => item.name === "Total Registered Users")?.value;
    const featureCounts = new Map(charts.features.map(({ name, count }) => [name, count]));
    const featureNames = featureDataset ? Array.from(new Set(model.rows.events.map((row) => String(row.feature_name)))).sort() : [];
    document.querySelector("#feature-table-body").innerHTML = featureNames.length ? featureNames.map((name) => {
      const users = featureUsers.get(name)?.size || 0;
      return `<tr><td>${escapeHtml(name)}</td><td>${formatNumber(featureCounts.get(name) || 0)}</td><td>${formatNumber(users)}</td><td>${typeof registered === "number" && registered ? `${(users / registered * 100).toFixed(2)}%` : "—"}</td></tr>`;
    }).join("") : `<tr><td colspan="4" class="empty-row">Feature Events source is not available.</td></tr>`;
    const featurePlatformCounts = new Map();
    model.rows.events.forEach((row) => {
      const feature = String(row.feature_name || "(missing)");
      const platform = String(row.platform || "(missing)");
      const key = `${feature}\u0000${platform}`;
      featurePlatformCounts.set(key, (featurePlatformCounts.get(key) || 0) + 1);
    });
    document.querySelector("#feature-platform-body").innerHTML = featurePlatformCounts.size
      ? Array.from(featurePlatformCounts.entries()).sort((left, right) => left[0].localeCompare(right[0])).map(([key, count]) => {
        const [feature, platform] = key.split("\u0000");
        return `<tr><td>${escapeHtml(feature)}</td><td>${escapeHtml(platform)}</td><td>${formatNumber(count)}</td></tr>`;
      }).join("")
      : `<tr><td colspan="3" class="empty-row">No feature event rows in the selected range.</td></tr>`;

    const kpi = (name) => model.kpis.find((item) => item.name === name);
    const sessionNames = ["Average Sessions per User", "Average Session Duration", "Average Events per Session", "Average Features per Session"];
    document.querySelector("#session-summary-body").innerHTML = sessionNames.map((name) => {
      const item = kpi(name);
      return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(formatMetric(name, item?.value))}</td><td>${escapeHtml(item?.limitation || item?.formula || "Not available")}</td></tr>`;
    }).join("");

    const funnelRows = charts.taskFunnel;
    const taskRates = ["Task Completion Rate", "Task Failure Rate", "Task Abandonment Rate"];
    document.querySelector("#task-summary-body").innerHTML = [
      ...funnelRows.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${formatNumber(item.value)}</td><td>Unique activity_id records with a valid lifecycle timestamp.</td></tr>`),
      ...taskRates.map((name) => `<tr><td>${escapeHtml(name)}</td><td>—</td><td>${escapeHtml(formatMetric(name, kpi(name)?.value))} of unique viewed activity records.</td></tr>`),
      `<tr><td>Average completion time</td><td>${escapeHtml(formatMetric("Average Task Completion Time", kpi("Average Task Completion Time")?.value))}</td><td>Valid non-negative started-to-completed timestamp pairs.</td></tr>`,
    ].join("");

    document.querySelector("#cohort-body").innerHTML = charts.cohort.length ? charts.cohort.map((row) => {
      const cell = (period) => period.rate === null ? `Not observed (${period.eligible} eligible)` : `${period.rate}% (${period.count}/${period.eligible})`;
      return `<tr><td>${escapeHtml(row.cohort)}</td><td>${formatNumber(row.users)}</td><td>${cell(row.d1)}</td><td>${cell(row.d7)}</td><td>${cell(row.d30)}</td></tr>`;
    }).join("") : `<tr><td colspan="5" class="empty-row">No cohort data is available.</td></tr>`;
    const cohorts = charts.cohort;
    plotChart("cohort-heatmap-chart", cohorts.length ? [{
      type: "heatmap", x: ["Day 1", "Day 7", "Day 30"], y: cohorts.map((row) => row.cohort),
      z: cohorts.map((row) => [row.d1.rate, row.d7.rate, row.d30.rate]),
      colorscale: [[0, "#eff7f3"], [0.5, "#83c6b1"], [1, "#087f75"]],
      zmin: 0, zmax: 100, hovertemplate: "%{y} · %{x}<br>%{z:.2f}%<extra></extra>",
      colorbar: { title: "Retention %" },
    }] : [], { margin: { l: 75, r: 35, t: 5, b: 35 }, xaxis: { side: "top" }, yaxis: { automargin: true } });
    document.querySelector("#user-detail-body").innerHTML = model.charts.users.length ? model.charts.users.slice(0, 100).map((row) => `<tr><td>${escapeHtml(row.user_id)}</td><td>${escapeHtml(row.registration_date)}</td><td>${escapeHtml(row.account_status)}</td><td>${escapeHtml(row.verification_status)}</td><td>${escapeHtml(row.onboarding_status)}</td><td>${formatNumber(row.active_days)}</td></tr>`).join("") : `<tr><td colspan="6" class="empty-row">Users dataset not available.</td></tr>`;
    document.querySelector("#milestone-users-body").innerHTML = charts.milestoneUsers.length ? charts.milestoneUsers.slice(0, 100).map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${formatNumber(row.count)}</td></tr>`).join("") : `<tr><td colspan="2" class="empty-row">Milestones dataset not available.</td></tr>`;

    document.querySelectorAll(".product-tab").forEach((button) => {
      button.onclick = () => {
        document.querySelectorAll(".product-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
        document.querySelectorAll(".product-module").forEach((module) => module.classList.toggle("hidden", module.dataset.productModule !== button.dataset.productTab));
      };
    });
  }

  function renderKpis(model) {
    const query = document.querySelector("#kpi-search").value.trim().toLocaleLowerCase();
    const status = document.querySelector("#kpi-status-filter").value;
    const visible = model.kpis.filter((item) => {
      const text = `${item.name} ${item.definition} ${item.source} ${item.sourceDataset} ${item.requiredFields} ${item.formula}`.toLocaleLowerCase();
      return (!query || text.includes(query)) && (!status || item.status === status);
    });
    document.querySelector("#kpi-count").textContent = `${visible.length} / ${model.kpis.length} KPIs`;
    document.querySelector("#kpi-body").innerHTML = visible.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(formatMetric(item.name, item.value))}</td><td><span class="status-chip ${item.status === "Calculable" ? "status-ready" : "status-observation"}">${escapeHtml(item.status)}</span></td><td>${escapeHtml(item.definition)}</td><td>${escapeHtml(item.formula)}</td><td>${escapeHtml(item.requiredFields)}</td><td>${escapeHtml(item.sourceDataset)}</td><td>${escapeHtml(item.frequency)}</td><td>${escapeHtml(item.interpretation)}</td><td>${escapeHtml(item.limitation)}</td></tr>`).join("") || `<tr><td colspan="10" class="empty-row">No KPIs match this search and status.</td></tr>`;
    document.querySelector("#requirements-body").innerHTML = model.unavailable.map((item) => `<tr><td>${escapeHtml(item.area)}</td><td>${escapeHtml(item.reason)}</td><td>${escapeHtml(item.fields)}</td><td>${escapeHtml(item.priority)}</td><td>Product / Data owner to confirm</td><td>Proposed; not supplied or verified</td></tr>`).join("");
  }

  function renderDictionary(model) {
    const search = document.querySelector("#dictionary-search").value.trim().toLocaleLowerCase();
    const datasetFilter = document.querySelector("#dictionary-dataset-filter");
    const statusFilter = document.querySelector("#dictionary-status-filter").value;
    const selected = datasetFilter.value;
    const sources = Array.from(new Set(model.dictionary.map((row) => row.dataset))).sort();
    if (datasetFilter.options.length !== sources.length + 1) {
      datasetFilter.replaceChildren(new Option("All datasets", ""), ...sources.map((source) => new Option(source, source)));
      if (sources.includes(selected)) datasetFilter.value = selected;
    }
    const rows = model.dictionary.filter((row) => {
      const text = Object.values(row).join(" ").toLocaleLowerCase();
      return (!search || text.includes(search)) && (!datasetFilter.value || row.dataset === datasetFilter.value) && (!statusFilter || row.status === statusFilter);
    });
    document.querySelector("#dictionary-count").textContent = `${rows.length} / ${model.dictionary.length} fields`;
    document.querySelector("#dictionary-body").innerHTML = rows.map((row) => `<tr><td>${escapeHtml(row.dataset)}</td><td>${escapeHtml(row.field)}</td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.definition)}</td><td>${escapeHtml(row.example)}</td><td>${escapeHtml(row.required)}</td><td>${escapeHtml(row.allowed)}</td><td>${escapeHtml(row.validation)}</td><td>${escapeHtml(row.sensitivity)}</td><td>${escapeHtml(row.analyticalUse)}</td><td>${escapeHtml(row.status)}</td></tr>`).join("") || `<tr><td colspan="11" class="empty-row">No observed fields match this filter.</td></tr>`;
  }

  function createReport() {
    if (!window.XLSX || !state.datasets.length || !state.analytics) {
      showToast("Load a readable dataset before generating a workbook.");
      return;
    }
    const workbook = XLSX.utils.book_new();
    const usedNames = new Set();
    const addJsonSheet = (name, rows) => {
      const safeRows = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, excelSafe(value)])));
      const contents = safeRows.length ? safeRows : [{ status: "No findings for this report section." }];
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(contents), safeSheetName(name, usedNames));
    };
    const inventory = state.datasets.map((dataset) => ({
      dataset: dataset.id,
      source_file: dataset.sourceName,
      sheet: dataset.sheetName,
      classification: "SIMULATED / USER-SUPPLIED",
      records: dataset.rows.length,
      columns: dataset.columns.length,
      duplicate_rows: dataset.duplicateRows,
    }));
    addJsonSheet("Inventory", inventory);

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
    addJsonSheet("Column Profile", profiles);
    addJsonSheet("KPI Catalogue", state.analytics.kpis.map((item) => ({
      kpi: item.name, value: item.value, availability: item.status, definition: item.definition,
      formula: item.formula, required_fields: item.requiredFields, source_dataset: item.sourceDataset,
      frequency: item.frequency, purpose: item.purpose, interpretation: item.interpretation,
      limitations: item.limitation,
    })));
    addJsonSheet("Data Dictionary", state.analytics.dictionary.map((row) => ({
      dataset: row.dataset, field: row.field, type: row.type, definition: row.definition,
      example: row.example, required: row.required, allowed_values: row.allowed, validation: row.validation,
      source: row.source, sensitivity: row.sensitivity, analytical_use: row.analyticalUse, status: row.status,
    })));
    addJsonSheet("Quality Findings", state.analytics.quality.map((finding) => ({
      issue_id: finding.id, dataset: finding.dataset, field: finding.field, issue_type: finding.type,
      affected_records: finding.affected, severity: finding.severity, status: "Needs review", detection_logic: finding.logic,
      suggested_correction: finding.suggestion, prevention_rule: finding.prevention,
    })));
    addJsonSheet("Relationships", state.analytics.relationships.map((row) => ({
      source_dataset: row.dataset, foreign_key_candidate: row.field, reference_dataset: row.reference,
      reference_key: row.referenceKey, cardinality_candidate: row.cardinality, source_rows: row.sourceRows, matched_rows: row.matchedRows,
      orphan_rows: row.orphanRows, match_percent: row.matchRate, duplicate_reference_keys: row.duplicateReferenceKeys,
      evidence: row.evidence,
    })));
    addJsonSheet("Coverage Matrix", buildCoverageRows(state.analytics));
    addJsonSheet("Future Data Requirements", state.analytics.unavailable.map((item) => ({
      area: item.area, reason: item.reason, suggested_fields: item.fields, priority: item.priority,
      owner: "Product / Data owner to confirm", verification: "Proposed; not supplied or verified",
    })));
    addJsonSheet("Executive Summary", state.analytics.kpis.filter((item) => [
      "Total Registered Users", "Daily Active Users", "Monthly Active Users", "Average Session Duration",
      "Feature Adoption Rate", "Task Completion Rate", "Returning User Rate",
    ].includes(item.name)).map((item) => ({
      kpi: item.name, value: item.value, availability: item.status, source: item.sourceDataset,
      definition: item.definition, limitation: item.limitation,
    })));

    const privacyNotes = [];
    for (const dataset of state.datasets) {
      const excluded = dataset.columns.filter(isSensitive);
      for (const field of excluded) privacyNotes.push({ dataset: dataset.id, excluded_field: field, reason: "Direct-identifier field excluded from report output." });
      const safeIndexes = dataset.columns.map((column, index) => ({ column, index })).filter(({ column }) => !isSensitive(column));
      const safeRows = dataset.rows.map((row) => safeIndexes.map(({ index }) => excelSafe(row[index])));
      const sheet = XLSX.utils.aoa_to_sheet([safeIndexes.map(({ column }) => excelSafe(column)), ...safeRows]);
      XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(dataset.id, usedNames));
    }
    addJsonSheet("Privacy Notes", privacyNotes);

    const filename = `veloop_data_audit_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, filename, { compression: true });
    showToast("Analytics audit workbook downloaded. Direct-identifier source columns were excluded.");
  }

  function printExecutiveReport() {
    if (!state.datasets.length) {
      showToast("Load source datasets before printing the executive report.");
      return;
    }
    const previousPage = state.currentPage;
    setPage("Executive Overview");
    window.setTimeout(() => window.print(), 150);
    window.addEventListener("afterprint", () => setPage(previousPage), { once: true });
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
  ["product-date-start", "product-date-end", "product-date-start-secondary", "product-date-end-secondary"].forEach((id) => {
    document.getElementById(id).addEventListener("change", (event) => {
      const primaryId = event.target.id.replace("-secondary", "");
      document.getElementById(primaryId).value = event.target.value;
      renderProductAnalytics();
    });
  });
  document.querySelector("#kpi-search").addEventListener("input", () => state.analytics && renderKpis(state.analytics));
  document.querySelector("#kpi-status-filter").addEventListener("change", () => state.analytics && renderKpis(state.analytics));
  document.querySelector("#dictionary-search").addEventListener("input", () => state.analytics && renderDictionary(state.analytics));
  document.querySelector("#dictionary-dataset-filter").addEventListener("change", () => state.analytics && renderDictionary(state.analytics));
  document.querySelector("#dictionary-status-filter").addEventListener("change", () => state.analytics && renderDictionary(state.analytics));
  elements.downloadReport.addEventListener("click", createReport);
  document.querySelector("#print-executive-report").addEventListener("click", printExecutiveReport);
  document.querySelector("#mobile-menu").addEventListener("click", () => elements.sidebar.classList.toggle("open"));
  window.addEventListener("resize", () => {
    if (state.datasets.length && window.Plotly) {
      document.querySelectorAll(".chart-area").forEach((chart) => {
        if (chart.data) Plotly.Plots.resize(chart);
      });
    }
  });

  setPage("Overview");
})();