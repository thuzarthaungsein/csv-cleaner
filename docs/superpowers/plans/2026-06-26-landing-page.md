# Landing Page with Inline Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a landing page at `GET /` where a user can drag-and-drop or browse for a CSV, upload it, and see the resulting report (or a clear error) appear on the same page — no redirect, no page reload.

**Architecture:** Extract the report page's body content into a reusable fragment-render function in `report.ts`, expose it via a new `GET /report/:id/fragment` JSON endpoint, and add a new `src/routes/landing.ts` serving a standalone HTML page with inline client-side JavaScript that drives the dropzone, calls the existing `POST /upload`, then fetches and injects the fragment on success.

**Tech Stack:** Hono 4.x, Tailwind CSS via CDN, Chart.js via CDN, vanilla client-side JavaScript (this plan's first), `node:test`.

## Global Constraints

- `src/routes/report.ts` and `test/report.test.ts` use SEMICOLONS (a prior local deviation from this project's usual no-semicolon style) — match that file's existing convention for anything added to it
- `src/routes/landing.ts`, `src/index.ts`, and other test files use NO semicolons, 4-space indent, trailing commas allowed, camelCase variables/functions — match each file's existing convention
- `POST /upload`'s existing JSON contract must not change — curl/API consumers see no difference
- `GET /report/:id`'s existing rendered output must not change — `renderDone`'s visual result stays identical after the refactor
- `GET /report/:id/fragment` only ever needs to handle `status === "done"` jobs — no in-progress/failed rendering in this endpoint
- No new npm dependencies — file streaming, JSON responses, and the landing page's JS all use what's already available (Hono, native fetch, native FormData)

---

## Task 1: Extract `renderReportFragment` from `renderDone` and add `GET /report/:id/fragment`

**Files:**
- Modify: `src/routes/report.ts`
- Modify: `test/report.test.ts`

**Interfaces:**
- Consumes: `Job` type and `getJob` from `../repositories/job.js` (already imported in this file).
- Produces:
  ```typescript
  interface ReportChartData {
      rowBefore: number
      rowAfter: number
      wasEnriched: boolean
      coverage: number
  }

  function renderReportFragment(job: Job): { html: string; chartData: ReportChartData }
  ```
  Task 2 (the landing page's JS) consumes the new `GET /report/:id/fragment` endpoint's JSON shape: `{ html: string, chartData: ReportChartData }` on success, or `{ error: string }` with status `404`/`400` on failure. `renderDone` (existing, unchanged route `GET /:id`) consumes `renderReportFragment` internally — no external caller depends on `renderDone`'s internals changing.

- [ ] **Step 1: Write the failing test for the fragment endpoint**

Add these tests to `test/report.test.ts`, after the existing "GET /report/:id/download returns 404 when the output file is missing from disk" test (this file already imports `Hono`, `buildReportRoute`, `createJob`, `completeJob`, `mkdir`, `writeFile`, `rm` — no new imports needed):

```typescript
test("GET /report/:id/fragment returns 404 for missing job", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const res = await app.request("/report/999999/fragment")
    assert.equal(res.status, 404)
})

test("GET /report/:id/fragment returns 400 for a job that is not done", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const job = await createJob("pending_fragment.csv")

    const res = await app.request(`/report/${job.id}/fragment`)
    assert.equal(res.status, 400)
})

test("GET /report/:id/fragment returns html and chartData for a done job", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const job = await createJob("fragment_job.csv")
    await completeJob(job.id, {
        rowCountBefore: 10,
        rowCountAfter: 8,
        enrichedApi: "mledoze/countries",
        enrichedColumns: ["region", "cca3"],
        skippedRows: 1,
        outputPath: "outputs/fragment_job_cleaned_enriched.csv",
    })

    const res = await app.request(`/report/${job.id}/fragment`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.html.includes("fragment_job.csv"))
    assert.ok(body.html.includes("Download CSV"))
    assert.ok(body.html.includes("coverageChart"))
    assert.deepEqual(body.chartData, {
        rowBefore: 10,
        rowAfter: 8,
        wasEnriched: true,
        coverage: 88,
    })
})

test("GET /report/:id/fragment reflects not-enriched jobs in chartData", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const job = await createJob("fragment_not_enriched.csv")
    await completeJob(job.id, {
        rowCountBefore: 10,
        rowCountAfter: 8,
        enrichedApi: null,
        enrichedColumns: [],
        skippedRows: 0,
        outputPath: "outputs/fragment_not_enriched_cleaned.csv",
    })

    const res = await app.request(`/report/${job.id}/fragment`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(!body.html.includes("coverageChart"))
    assert.ok(body.html.includes("Not enriched (no country column detected)"))
    assert.deepEqual(body.chartData, {
        rowBefore: 10,
        rowAfter: 8,
        wasEnriched: false,
        coverage: 0,
    })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --env-file=.env --test test/report.test.ts`
Expected: FAIL — `/fragment` route doesn't exist yet, so all 4 new tests fail with 404s from Hono's default not-found handling (or, for the body-shape tests, a failure parsing JSON from a 404 HTML/JSON error response).

- [ ] **Step 3: Refactor `report.ts` to extract `renderReportFragment`**

Replace the entire `renderDone` function (and everything between it and `buildReportRoute`) with the following. This extracts the body content + chart data into `renderReportFragment`, and has `renderDone` call it and wrap the result in the full document shell with its own `<script>` tag (identical visual output to before):

```typescript
interface ReportChartData {
  rowBefore: number;
  rowAfter: number;
  wasEnriched: boolean;
  coverage: number;
}

function renderReportFragment(job: Job): { html: string; chartData: ReportChartData } {
  const fileName = escapeHtml(job.file_name);
  const status = escapeHtml(job.status);
  const rowBefore = job.row_count_before ?? 0;
  const rowAfter = job.row_count_after ?? 0;
  const skipped = job.skipped_rows ?? 0;
  const wasEnriched = job.enriched_columns !== null;
  const coverage =
    wasEnriched && rowAfter > 0
      ? Math.round(((rowAfter - skipped) / rowAfter) * 100)
      : 0;
  const enrichedColumns = escapeHtml(job.enriched_columns ?? "none");
  const statusBadgeClass =
    job.status === "done"
      ? "bg-green-100 text-green-700"
      : job.status === "failed"
        ? "bg-red-100 text-red-700"
        : "bg-amber-100 text-amber-700";

  const html = `
        <div class="flex items-center justify-between">
            <h1 class="text-2xl font-bold text-gray-900">Report: <span class="font-mono text-gray-600">${fileName}</span></h1>
            <div class="flex items-center gap-3">
                <a href="/report/${job.id}/download" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold shadow hover:bg-blue-700 transition-colors">Download CSV</a>
                <span class="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusBadgeClass}">${status}</span>
            </div>
        </div>

        <div class="bg-white rounded-xl shadow overflow-hidden border border-gray-100">
            <div class="px-5 py-3 border-b border-gray-100 bg-gray-50">
                <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide">Summary</h2>
            </div>
            <table class="w-full text-left">
                <tbody class="divide-y divide-gray-100">
                    <tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 w-1/3">Status</th><td class="p-3 px-5 text-gray-900"><span class="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusBadgeClass}">${status}</span></td></tr>
                    <tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 w-1/3">Filename</th><td class="p-3 px-5 text-gray-900 font-mono text-sm">${fileName}</td></tr>
                    <tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 w-1/3">Row count before</th><td class="p-3 px-5 text-gray-900 font-semibold">${rowBefore}</td></tr>
                    <tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 w-1/3">Row count after</th><td class="p-3 px-5 text-gray-900 font-semibold">${rowAfter}</td></tr>
                    <tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 w-1/3">Enriched columns</th><td class="p-3 px-5 text-gray-900">${enrichedColumns}</td></tr>
                    <tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 w-1/3">Skipped rows</th><td class="p-3 px-5 text-red-600 font-semibold">${skipped}</td></tr>
                </tbody>
            </table>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-white rounded-lg shadow p-5 border border-gray-100">
            <div class="flex items-center gap-2 mb-3">
                <span class="inline-block w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide">Row Count</h2>
            </div>
            <canvas id="rowCountChart"></canvas>
        </div>
        <div class="bg-white rounded-lg shadow p-5 border border-gray-100">
            <div class="flex items-center gap-2 mb-3">
                <span class="inline-block w-2.5 h-2.5 rounded-full bg-green-500"></span>
                <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide">Enrichment Coverage</h2>
            </div>
            ${
              wasEnriched
                ? `<canvas id="coverageChart"></canvas>`
                : `<div class="flex items-center justify-center h-48 text-gray-400 italic text-sm">Not enriched (no country column detected)</div>`
            }
        </div>
        </div>`;

  return { html, chartData: { rowBefore, rowAfter, wasEnriched, coverage } };
}

function buildChartScript(chartData: ReportChartData): string {
  const { rowBefore, rowAfter, wasEnriched, coverage } = chartData;
  return `
        new Chart(document.getElementById("rowCountChart"), {
            type: "bar",
            data: {
                labels: ["Before", "After"],
                datasets: [{ label: "Row count", data: [${rowBefore}, ${rowAfter}], backgroundColor: ["#94a3b8", "#3b82f6"] }],
            },
        })
        ${
          wasEnriched
            ? `new Chart(document.getElementById("coverageChart"), {
            type: "bar",
            data: {
                labels: ["Enrichment coverage %"],
                datasets: [{ label: "Coverage", data: [${coverage}], backgroundColor: ["#22c55e"] }],
            },
            options: { scales: { y: { max: 100 } } },
        })`
            : ""
        }`;
}

function renderDone(job: Job): string {
  const { html, chartData } = renderReportFragment(job);

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Report - Job ${job.id}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-gray-50 p-8">
    <div class="max-w-5xl mx-auto space-y-6">${html}
    </div>

    <script>${buildChartScript(chartData)}
    </script>
</body>
</html>`;
}
```

Note: `renderInProgress` and `escapeHtml` above this point in the file are unchanged — do not modify them.

- [ ] **Step 4: Add the new route to `buildReportRoute`**

Find the existing `buildReportRoute` function:
```typescript
export function buildReportRoute() {
  const route = new Hono();

  route.get("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const job = await getJob(id);

    if (!job) {
      return c.json({ error: "job not found" }, 404);
    }

    const html =
      job.status === "done" ? renderDone(job) : renderInProgress(job);

    return c.html(html);
  });

  route.get("/:id/download", async (c) => {
```

Add a new route between the `/:id` route and the `/:id/download` route:
```typescript
  route.get("/:id/fragment", async (c) => {
    const id = Number(c.req.param("id"));
    const job = await getJob(id);

    if (!job) {
      return c.json({ error: "job not found" }, 404);
    }

    if (job.status !== "done") {
      return c.json({ error: "job not finished" }, 400);
    }

    const { html, chartData } = renderReportFragment(job);
    return c.json({ html, chartData });
  });

```
(Insert this directly after the closing `});` of the `/:id` route handler and before `route.get("/:id/download", ...)`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsx --env-file=.env --test test/report.test.ts`
Expected: PASS (15/15 tests: 11 previous + 4 new). Verify specifically that the pre-existing "renders charts and summary table for a done job" and "includes a download link" tests still pass — these confirm `renderDone`'s output is unchanged after the refactor.

- [ ] **Step 6: Run the full test suite**

Run: `npm test` (ensure `docker compose ps` shows Postgres running first, `docker compose up -d` if not)
Expected: PASS, all tests green (41 total: 37 previous + 4 new).

- [ ] **Step 7: Run code-reviewer agent and code-review plugin, then commit**

Invoke the `code-reviewer` agent to confirm `renderDone`'s rendered HTML is byte-for-byte equivalent to before the refactor (the existing tests should already prove this, but ask the reviewer to specifically diff old vs new output mentally), and that `report.ts` still only touches Postgres via `getJob`. Then run the `code-review` plugin. Then commit with a short single-line message:

```bash
git add src/routes/report.ts test/report.test.ts
git commit -m "feat: extract report fragment and add GET /report/:id/fragment"
```

---

## Task 2: Build the landing page at `GET /`

**Files:**
- Create: `src/routes/landing.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `POST /upload` (existing, unchanged — returns `{jobId, status, fileName}` on `200`, or `{jobId, status, fileName, errorMessage}` on `500` for a pipeline failure, or `{error, message}` on `500` for a pipeline-start failure) and `GET /report/:id/fragment` (from Task 1 — returns `{html, chartData}` on `200`, `{error}` on `404`/`400`).
- Produces: `export function buildLandingRoute(): Hono` — a Hono router with a single `GET /` handler returning the landing page HTML. Mounted in `index.ts` at the root path. No other file depends on this route's internals.

- [ ] **Step 1: Create `src/routes/landing.ts`**

```typescript
import { Hono } from "hono"

function renderLandingPage(): string {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>CSV Cleaner</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-gray-50 p-8">
    <div class="max-w-3xl mx-auto space-y-6">
        <div class="text-center">
            <h1 class="text-2xl font-bold text-gray-900">CSV Cleaner</h1>
            <p class="text-gray-500 text-sm mt-1">Upload, validate, clean, enrich your CSV in one step</p>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div class="bg-white rounded-lg p-4 text-center border border-gray-100">
                <div class="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm mx-auto mb-2">1</div>
                <div class="font-semibold text-xs text-gray-800">Validate</div>
                <div class="text-xs text-gray-400 mt-1">Schema &amp; data checks</div>
            </div>
            <div class="bg-white rounded-lg p-4 text-center border border-gray-100">
                <div class="w-7 h-7 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold text-sm mx-auto mb-2">2</div>
                <div class="font-semibold text-xs text-gray-800">Clean</div>
                <div class="text-xs text-gray-400 mt-1">Dedupe &amp; normalize</div>
            </div>
            <div class="bg-white rounded-lg p-4 text-center border border-gray-100">
                <div class="w-7 h-7 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-sm mx-auto mb-2">3</div>
                <div class="font-semibold text-xs text-gray-800">Enrich</div>
                <div class="text-xs text-gray-400 mt-1">Country data join</div>
            </div>
            <div class="bg-white rounded-lg p-4 text-center border border-gray-100">
                <div class="w-7 h-7 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-sm mx-auto mb-2">4</div>
                <div class="font-semibold text-xs text-gray-800">Report</div>
                <div class="text-xs text-gray-400 mt-1">Charts &amp; summary</div>
            </div>
        </div>

        <div class="bg-white rounded-xl shadow p-6 border border-gray-100">
            <div id="dropzone" class="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer transition-colors">
                <div id="dropzoneIdle">
                    <div class="text-3xl mb-2">&#8593;</div>
                    <div class="font-semibold text-sm text-gray-700">Drag &amp; drop your CSV here</div>
                    <div class="text-xs text-gray-400 mt-1">or click to browse</div>
                </div>
                <div id="dropzoneSelected" class="hidden">
                    <div class="text-3xl mb-2 text-green-600">&#10003;</div>
                    <div id="selectedFileName" class="font-semibold text-sm text-green-800"></div>
                    <div id="selectedFileSize" class="text-xs text-gray-500 mt-1"></div>
                </div>
                <input type="file" id="fileInput" accept=".csv" class="hidden">
            </div>

            <button id="uploadButton" disabled class="w-full mt-4 px-4 py-3 rounded-lg bg-blue-600 text-white font-semibold text-sm shadow hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <span id="uploadButtonSpinner" class="hidden w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                <span id="uploadButtonText">Upload</span>
            </button>

            <div id="errorBanner" class="hidden mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2 items-start">
                <span class="text-red-600 font-bold">&#9888;</span>
                <div>
                    <div class="font-semibold text-xs text-red-800">Upload failed</div>
                    <div id="errorBannerMessage" class="text-xs text-red-700 mt-1 font-mono"></div>
                </div>
            </div>
        </div>

        <div id="resultContainer" class="space-y-6"></div>
    </div>

    <script>
        const dropzone = document.getElementById("dropzone")
        const dropzoneIdle = document.getElementById("dropzoneIdle")
        const dropzoneSelected = document.getElementById("dropzoneSelected")
        const selectedFileName = document.getElementById("selectedFileName")
        const selectedFileSize = document.getElementById("selectedFileSize")
        const fileInput = document.getElementById("fileInput")
        const uploadButton = document.getElementById("uploadButton")
        const uploadButtonSpinner = document.getElementById("uploadButtonSpinner")
        const uploadButtonText = document.getElementById("uploadButtonText")
        const errorBanner = document.getElementById("errorBanner")
        const errorBannerMessage = document.getElementById("errorBannerMessage")
        const resultContainer = document.getElementById("resultContainer")

        let selectedFile = null

        function formatFileSize(bytes) {
            if (bytes < 1024) return bytes + " B"
            return (bytes / 1024).toFixed(1) + " KB"
        }

        function setFile(file) {
            selectedFile = file
            dropzoneIdle.classList.add("hidden")
            dropzoneSelected.classList.remove("hidden")
            selectedFileName.textContent = file.name
            selectedFileSize.textContent = formatFileSize(file.size) + " \\u00b7 click to change"
            dropzone.classList.remove("border-blue-500", "bg-blue-50")
            dropzone.classList.add("border-green-500", "bg-green-50")
            uploadButton.disabled = false
        }

        dropzone.addEventListener("click", () => fileInput.click())

        fileInput.addEventListener("change", () => {
            if (fileInput.files.length > 0) {
                setFile(fileInput.files[0])
            }
        })

        dropzone.addEventListener("dragover", (event) => {
            event.preventDefault()
            dropzone.classList.add("border-blue-500", "bg-blue-50")
        })

        dropzone.addEventListener("dragleave", () => {
            if (!selectedFile) {
                dropzone.classList.remove("border-blue-500", "bg-blue-50")
            }
        })

        dropzone.addEventListener("drop", (event) => {
            event.preventDefault()
            if (event.dataTransfer.files.length > 0) {
                setFile(event.dataTransfer.files[0])
            }
        })

        function showError(message) {
            errorBannerMessage.textContent = message
            errorBanner.classList.remove("hidden")
        }

        function hideError() {
            errorBanner.classList.add("hidden")
        }

        function setLoading(isLoading) {
            uploadButton.disabled = isLoading
            uploadButtonSpinner.classList.toggle("hidden", !isLoading)
            uploadButtonText.textContent = isLoading ? "Processing..." : "Upload"
        }

        function renderChartsInto(chartData) {
            new Chart(document.getElementById("rowCountChart"), {
                type: "bar",
                data: {
                    labels: ["Before", "After"],
                    datasets: [{ label: "Row count", data: [chartData.rowBefore, chartData.rowAfter], backgroundColor: ["#94a3b8", "#3b82f6"] }],
                },
            })
            if (chartData.wasEnriched) {
                new Chart(document.getElementById("coverageChart"), {
                    type: "bar",
                    data: {
                        labels: ["Enrichment coverage %"],
                        datasets: [{ label: "Coverage", data: [chartData.coverage], backgroundColor: ["#22c55e"] }],
                    },
                    options: { scales: { y: { max: 100 } } },
                })
            }
        }

        async function loadFragment(jobId) {
            const res = await fetch("/report/" + jobId + "/fragment")
            if (!res.ok) {
                throw new Error("could not load report")
            }
            const body = await res.json()
            resultContainer.innerHTML = body.html
            renderChartsInto(body.chartData)
        }

        uploadButton.addEventListener("click", async () => {
            if (!selectedFile) return
            hideError()
            resultContainer.innerHTML = ""
            setLoading(true)

            const formData = new FormData()
            formData.append("file", selectedFile)

            try {
                const res = await fetch("/upload", { method: "POST", body: formData })
                const body = await res.json()

                if (res.ok && body.status === "done") {
                    await loadFragment(body.jobId)
                } else {
                    showError(body.errorMessage || body.message || "Upload failed")
                }
            } catch (error) {
                showError(error.message || "Upload failed")
            } finally {
                setLoading(false)
            }
        })
    </script>
</body>
</html>`
}

export function buildLandingRoute() {
    const route = new Hono()

    route.get("/", (c) => {
        return c.html(renderLandingPage())
    })

    return route
}
```

- [ ] **Step 2: Mount the landing route in `src/index.ts`**

Replace the contents of `src/index.ts`:
```typescript
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { buildUploadRoute } from "./routes/upload.js"
import { buildReportRoute } from "./routes/report.js"
import { buildLandingRoute } from "./routes/landing.js"
import { fetchCountryCache } from "./services/enricher.js"

const app = new Hono()

app.get("/health", (c) => {
    return c.json({ status: "ok" })
})

const countryCache = await fetchCountryCache()
app.route("/", buildLandingRoute())
app.route("/upload", buildUploadRoute(countryCache))
app.route("/report", buildReportRoute())

const port = Number(process.env.PORT) || 3000

serve({ fetch: app.fetch, port }, (info) => {
    console.log(`csv-cleaner listening on http://localhost:${info.port}`)
})
```

- [ ] **Step 3: Run a quick automated check that the route returns HTML**

There is no dedicated automated test for this route per the design spec (the project's first client-side JS is verified manually, not via an automated browser test) — but add one minimal smoke-level test to confirm the route is wired up and returns a 200 with the expected page structure. Create `test/landing.test.ts`:

```typescript
import { test } from "node:test"
import assert from "node:assert/strict"
import { Hono } from "hono"
import { buildLandingRoute } from "../src/routes/landing.js"

test("GET / returns the landing page with the upload form", async () => {
    const app = new Hono()
    app.route("/", buildLandingRoute())

    const res = await app.request("/")
    const html = await res.text()
    assert.equal(res.status, 200)
    assert.ok(html.includes("CSV Cleaner"))
    assert.ok(html.includes('id="dropzone"'))
    assert.ok(html.includes('id="uploadButton"'))
    assert.ok(html.includes("tailwindcss"))
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --env-file=.env --test test/landing.test.ts`
Expected: PASS (1/1 test)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS, all tests green (42 total: 41 from Task 1 + 1 new).

- [ ] **Step 6: Manual smoke test in a real browser**

Run: `npm run dev` in the background (it loads `.env` via `--env-file=.env` automatically). Then open `http://localhost:3000/` in a browser and verify, in order:
1. The page loads with the title, 4-step pipeline strip, and dropzone visible. Upload button is disabled (grayed out).
2. Drag a CSV file (e.g. `test/fixtures/valid.csv`) over the dropzone — border turns blue.
3. Drop it — dropzone switches to the green "file selected" state showing the filename and size. Upload button becomes enabled.
4. Click Upload — button shows a spinner and "Processing...", then after the pipeline completes, the summary table and charts appear below the form (no page reload, no redirect — confirm the URL bar still shows `/`).
5. Click the "Download CSV" button inside the newly-appeared report fragment — confirm a file downloads.
6. Reload the page, this time select `test/fixtures/empty-column.csv` via click-to-browse (not drag-and-drop) instead — confirm clicking the dropzone opens a file picker, and selecting the file shows the same green "selected" state.
7. Click Upload — confirm the red error banner appears with a message containing "validation failed", and the Upload button is re-enabled afterward (not stuck in a disabled/loading state).
8. Without reloading, select `test/fixtures/valid.csv` again and click Upload — confirm the error banner disappears and the report fragment appears, proving the page supports multiple uploads without a reload.

Stop the dev server after confirming all 8 checks (`pkill -f "tsx watch"` or equivalent).

- [ ] **Step 7: Run code-reviewer agent and code-review plugin, then commit**

Invoke the `code-reviewer` agent to confirm `landing.ts` makes no direct DB/DuckDB calls (it only renders static HTML — all dynamic behavior happens client-side via `fetch` against existing routes), and that `index.ts`'s route mounting order doesn't cause `/` to shadow any other route (Hono matches `GET /` only for the exact root path, so `/upload` and `/report/*` remain unaffected — confirm this explicitly). Then run the `code-review` plugin. Then commit with a short single-line message:

```bash
git add src/routes/landing.ts src/index.ts test/landing.test.ts
git commit -m "feat: add landing page with inline upload and live report"
```

---

## Self-Review Notes

- Spec coverage: the fragment extraction, the new `/fragment` endpoint (done-only, 404/400 status codes), the landing page's visual structure (title, pipeline steps, 3-state dropzone, spinner button, error banner, result container), the client-side upload→fragment-fetch→chart-render flow, and the manual smoke-test checklist are each covered by a task.
- Type consistency: `ReportChartData`'s shape (`rowBefore`, `rowAfter`, `wasEnriched`, `coverage`) is defined once in Task 1 and consumed identically by the landing page's `renderChartsInto` function in Task 2 — field names match exactly (the JS destructures the same JSON keys the TypeScript interface defines).
- No placeholders: every step has runnable code or an exact command with an expected result. The manual smoke test (Task 2, Step 6) is the only non-automated verification, which matches the design spec's explicit decision not to write an automated browser test for this first piece of client-side JS.
- Verified `/upload`'s actual response shape (`{jobId, status, fileName}` on 200, `{jobId, status, fileName, errorMessage}` or `{error, message}` on 500) against the real `src/routes/upload.ts` before writing the landing page's JS — the `showError(body.errorMessage || body.message || "Upload failed")` line handles both failure shapes.
