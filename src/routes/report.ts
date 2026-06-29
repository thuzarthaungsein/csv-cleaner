import { Hono } from "hono";
import { createReadStream, existsSync } from "node:fs";
import { basename } from "node:path";
import { Readable } from "node:stream";
import type { Job } from "../repositories/job.js";
import { getJob } from "../repositories/job.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDownloadFileName(job: Job): string {
  return basename(job.output_path!);
}

interface ValidationFinding {
  column: string;
  issue: string;
  count?: number;
}

interface ValidationFindings {
  errors: ValidationFinding[];
  warnings: ValidationFinding[];
}

const ISSUE_LABELS: Record<string, string> = {
  empty_column: "Empty column",
  duplicate_row: "Duplicate rows found",
  high_null_ratio: "High null ratio",
  numeric_mismatch: "Mostly numeric, has non-numeric values",
  type_mismatch: "Looks like a date but isn't",
};

function describeFinding(finding: ValidationFinding): string {
  const label = ISSUE_LABELS[finding.issue] ?? finding.issue;
  const columnPart = finding.column === "*" ? "" : ` — ${escapeHtml(finding.column)}`;
  const countPart = finding.count !== undefined ? ` (${finding.count})` : "";
  return `${label}${columnPart}${countPart}`;
}

function renderFindingsRows(job: Job): string {
  if (!job.validation_findings) {
    return "";
  }

  const findings: ValidationFindings = JSON.parse(job.validation_findings);
  const errorRows = findings.errors
    .map(
      (finding) =>
        `<tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 whitespace-nowrap w-px">Validation</th><td class="p-3 px-5 text-red-600 font-medium">${describeFinding(finding)}</td></tr>`,
    )
    .join("");
  const warningRows = findings.warnings
    .map(
      (finding) =>
        `<tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 whitespace-nowrap w-px">Validation</th><td class="p-3 px-5 text-amber-600 font-medium">${describeFinding(finding)}</td></tr>`,
    )
    .join("");

  return errorRows + warningRows;
}

function renderInProgress(job: Job): string {
  const fileName = escapeHtml(job.file_name);
  const status = escapeHtml(job.status);
  const errorMessage = escapeHtml(job.error_message ?? "");

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Job ${job.id} - ${status}</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 p-8">
    <div class="max-w-xl mx-auto bg-white rounded-lg shadow p-6">
        <h1 class="text-xl font-bold mb-2">Job ${job.id}: ${fileName}</h1>
        <p class="text-gray-600">Status: <span class="font-mono">${status}</span></p>
        ${job.status === "failed" ? `<p class="text-red-600 mt-4">${errorMessage}</p>` : ""}
    </div>
</body>
</html>`;
}

interface ReportChartData {
  rowBefore: number;
  rowAfter: number;
  wasEnriched: boolean;
  coverage: number;
}

function renderReportFragment(job: Job): {
  html: string;
  chartData: ReportChartData;
} {
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
        

        <div class="bg-white rounded-xl shadow overflow-hidden border border-gray-100">
            <div class="px-5 py-3 border-b border-gray-100 bg-gray-50">
                <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide">Summary</h2>
            </div>
            <table class="w-full text-left">
                <tbody class="divide-y divide-gray-100">
                    <tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 whitespace-nowrap w-px">Status</th><td class="p-3 px-5 text-gray-900"><span class="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusBadgeClass}">${status}</span></td></tr>
                    <tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 whitespace-nowrap w-px">Filename</th><td class="p-3 px-5 text-gray-900 font-mono text-sm break-all">${fileName}</td></tr>
                    <tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 whitespace-nowrap w-px">Row count before</th><td class="p-3 px-5 text-gray-900 font-semibold">${rowBefore}</td></tr>
                    <tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 whitespace-nowrap w-px">Row count after</th><td class="p-3 px-5 text-gray-900 font-semibold">${rowAfter}</td></tr>
                    <tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 whitespace-nowrap w-px">Enriched columns</th><td class="p-3 px-5 text-gray-900">${enrichedColumns}</td></tr>
                    <tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 whitespace-nowrap w-px">Skipped rows</th><td class="p-3 px-5 text-red-600 font-semibold">${skipped}</td></tr>
                    ${renderFindingsRows(job)}
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
        </div>
        
        <a href="/report/${job.id}/download" class="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold shadow hover:bg-blue-700 transition-colors">Download Cleaned CSV</a>
        `;

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

  route.get("/:id/download", async (c) => {
    const id = Number(c.req.param("id"));
    const job = await getJob(id);

    if (!job) {
      return c.json({ error: "job not found" }, 404);
    }

    if (job.status !== "done" || !job.output_path) {
      return c.json({ error: "job not finished" }, 400);
    }

    if (!existsSync(job.output_path)) {
      return c.json({ error: "output file not found" }, 404);
    }

    const fileName = buildDownloadFileName(job);
    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", `attachment; filename="${fileName}"`);

    const nodeStream = createReadStream(job.output_path);
    return c.body(Readable.toWeb(nodeStream) as ReadableStream);
  });

  return route;
}
