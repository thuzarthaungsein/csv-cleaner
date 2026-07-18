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

function buildDownloadFileName(path: string): string {
  return basename(path);
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
  const columnPart = finding.column === "*" ? "" : ` — <span class="font-mono">${escapeHtml(finding.column)}</span>`;
  const countPart = finding.count !== undefined ? ` (<span class="font-mono">${finding.count}</span>)` : "";
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
        `<tr class="block md:table-row hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors py-2 md:py-0"><th class="block md:table-cell px-5 pt-3 pb-0.5 md:p-3 md:px-5 text-xs md:text-sm font-medium text-slate-500 dark:text-slate-400 uppercase md:normal-case tracking-wide md:tracking-normal md:whitespace-nowrap md:w-px">Validation</th><td class="block md:table-cell px-5 pb-3 pt-0.5 md:p-3 md:px-5 text-red-600 dark:text-red-400 font-medium">${describeFinding(finding)}</td></tr>`,
    )
    .join("");
  const warningRows = findings.warnings
    .map(
      (finding) =>
        `<tr class="block md:table-row hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors py-2 md:py-0"><th class="block md:table-cell px-5 pt-3 pb-0.5 md:p-3 md:px-5 text-xs md:text-sm font-medium text-slate-500 dark:text-slate-400 uppercase md:normal-case tracking-wide md:tracking-normal md:whitespace-nowrap md:w-px">Validation</th><td class="block md:table-cell px-5 pb-3 pt-0.5 md:p-3 md:px-5 text-amber-600 dark:text-amber-400 font-medium">${describeFinding(finding)}</td></tr>`,
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
    <script data-goatcounter="https://csv-cleaner.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
</head>
<body class="bg-slate-50 dark:bg-slate-950 p-4 sm:p-8">
    <div class="max-w-xl mx-auto bg-white dark:bg-slate-900 dark:shadow-none rounded-lg shadow p-6 border border-slate-200 dark:border-slate-800">
        <h1 class="text-xl font-bold mb-2 text-slate-900 dark:text-slate-100">Job <span class="font-mono">${job.id}</span>: ${fileName}</h1>
        <p class="text-slate-600 dark:text-slate-400">Status: <span class="font-mono">${status}</span></p>
        ${job.status === "failed" ? `<p class="text-red-600 dark:text-red-400 mt-4">${errorMessage}</p>` : ""}
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
  const hasEnrichedDownload = job.enriched_output_path !== null;
  const coverage =
    wasEnriched && rowAfter > 0
      ? Math.round(((rowAfter - skipped) / rowAfter) * 100)
      : 0;
  const enrichedColumns = escapeHtml(job.enriched_columns ?? "none");
  const statusBadgeClass =
    job.status === "done"
      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
      : job.status === "failed"
        ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
        : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400";

  const html = `


        <div class="bg-white dark:bg-slate-900 dark:shadow-none rounded-xl shadow overflow-hidden border border-slate-200 dark:border-slate-800">
            <div class="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
                <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">Summary</h2>
            </div>
            <table class="w-full text-left block md:table">
                <tbody class="block md:table-row-group divide-y divide-slate-100 dark:divide-slate-800">
                    <tr class="block md:table-row hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors py-2 md:py-0"><th class="block md:table-cell px-5 pt-3 pb-0.5 md:p-3 md:px-5 text-xs md:text-sm font-medium text-slate-500 dark:text-slate-400 uppercase md:normal-case tracking-wide md:tracking-normal md:whitespace-nowrap md:w-px">Status</th><td class="block md:table-cell px-5 pb-3 pt-0.5 md:p-3 md:px-5 text-slate-900 dark:text-slate-100"><span class="px-3 py-1 rounded-full text-xs font-mono font-semibold uppercase tracking-wide ${statusBadgeClass}">${status}</span></td></tr>
                    <tr class="block md:table-row hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors py-2 md:py-0"><th class="block md:table-cell px-5 pt-3 pb-0.5 md:p-3 md:px-5 text-xs md:text-sm font-medium text-slate-500 dark:text-slate-400 uppercase md:normal-case tracking-wide md:tracking-normal md:whitespace-nowrap md:w-px">Filename</th><td class="block md:table-cell px-5 pb-3 pt-0.5 md:p-3 md:px-5 text-slate-900 dark:text-slate-100 font-mono text-sm break-all">${fileName}</td></tr>
                    <tr class="block md:table-row hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors py-2 md:py-0"><th class="block md:table-cell px-5 pt-3 pb-0.5 md:p-3 md:px-5 text-xs md:text-sm font-medium text-slate-500 dark:text-slate-400 uppercase md:normal-case tracking-wide md:tracking-normal md:whitespace-nowrap md:w-px">Row count before</th><td class="block md:table-cell px-5 pb-3 pt-0.5 md:p-3 md:px-5 text-slate-900 dark:text-slate-100 font-mono font-semibold">${rowBefore}</td></tr>
                    <tr class="block md:table-row hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors py-2 md:py-0"><th class="block md:table-cell px-5 pt-3 pb-0.5 md:p-3 md:px-5 text-xs md:text-sm font-medium text-slate-500 dark:text-slate-400 uppercase md:normal-case tracking-wide md:tracking-normal md:whitespace-nowrap md:w-px">Row count after</th><td class="block md:table-cell px-5 pb-3 pt-0.5 md:p-3 md:px-5 text-slate-900 dark:text-slate-100 font-mono font-semibold">${rowAfter}</td></tr>
                    <tr class="block md:table-row hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors py-2 md:py-0"><th class="block md:table-cell px-5 pt-3 pb-0.5 md:p-3 md:px-5 text-xs md:text-sm font-medium text-slate-500 dark:text-slate-400 uppercase md:normal-case tracking-wide md:tracking-normal md:whitespace-nowrap md:w-px">Enriched columns</th><td class="block md:table-cell px-5 pb-3 pt-0.5 md:p-3 md:px-5 text-slate-900 dark:text-slate-100 font-mono text-sm">${enrichedColumns}</td></tr>
                    <tr class="block md:table-row hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors py-2 md:py-0"><th class="block md:table-cell px-5 pt-3 pb-0.5 md:p-3 md:px-5 text-xs md:text-sm font-medium text-slate-500 dark:text-slate-400 uppercase md:normal-case tracking-wide md:tracking-normal md:whitespace-nowrap md:w-px">Skipped rows</th><td class="block md:table-cell px-5 pb-3 pt-0.5 md:p-3 md:px-5 text-red-600 dark:text-red-400 font-mono font-semibold">${skipped}</td></tr>
                    ${renderFindingsRows(job)}
                </tbody>
            </table>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-white dark:bg-slate-900 dark:shadow-none rounded-lg shadow p-5 border border-slate-200 dark:border-slate-800">
            <div class="flex items-center gap-2 mb-3">
                <span class="inline-block w-2.5 h-2.5 rounded-full bg-indigo-500 dark:bg-indigo-400"></span>
                <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">Row Count</h2>
            </div>
            <canvas id="rowCountChart"></canvas>
        </div>
        <div class="bg-white dark:bg-slate-900 dark:shadow-none rounded-lg shadow p-5 border border-slate-200 dark:border-slate-800">
            <div class="flex items-center gap-2 mb-3">
                <span class="inline-block w-2.5 h-2.5 rounded-full bg-green-500 dark:bg-green-400"></span>
                <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">Enrichment Coverage</h2>
            </div>
            ${
              wasEnriched
                ? `<canvas id="coverageChart"></canvas>`
                : `<div class="flex items-center justify-center h-48 text-slate-400 dark:text-slate-600 italic text-sm">Not enriched (no country column detected)</div>`
            }
        </div>
        </div>

        <div class="flex flex-col sm:flex-row gap-3">
        <a href="/report/${job.id}/download" class="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg bg-indigo-700 dark:bg-indigo-500 text-white text-sm font-semibold shadow hover:bg-indigo-800 dark:hover:bg-indigo-400 transition-colors">Download Cleaned CSV</a>
        ${
          hasEnrichedDownload
            ? `<a href="/report/${job.id}/download/enriched" class="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg bg-green-600 dark:bg-green-500 text-white text-sm font-semibold shadow hover:bg-green-700 dark:hover:bg-green-400 transition-colors">Download Enriched CSV</a>`
            : ""
        }
        </div>
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
                datasets: [{ label: "Row count", data: [${rowBefore}, ${rowAfter}], backgroundColor: ["#94a3b8", "#818CF8"] }],
            },
        })
        ${
          wasEnriched
            ? `new Chart(document.getElementById("coverageChart"), {
            type: "bar",
            data: {
                labels: ["Enrichment coverage %"],
                datasets: [{ label: "Coverage", data: [${coverage}], backgroundColor: ["#34d399"] }],
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
    <script data-goatcounter="https://csv-cleaner.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
</head>
<body class="bg-slate-50 dark:bg-slate-950 p-4 sm:p-8">
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

    const fileName = buildDownloadFileName(job.output_path);
    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", `attachment; filename="${fileName}"`);

    const nodeStream = createReadStream(job.output_path);
    return c.body(Readable.toWeb(nodeStream) as ReadableStream);
  });

  route.get("/:id/download/enriched", async (c) => {
    const id = Number(c.req.param("id"));
    const job = await getJob(id);

    if (!job) {
      return c.json({ error: "job not found" }, 404);
    }

    if (job.status !== "done" || !job.enriched_output_path) {
      return c.json({ error: "enriched output not available" }, 400);
    }

    if (!existsSync(job.enriched_output_path)) {
      return c.json({ error: "output file not found" }, 404);
    }

    const fileName = buildDownloadFileName(job.enriched_output_path);
    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", `attachment; filename="${fileName}"`);

    const nodeStream = createReadStream(job.enriched_output_path);
    return c.body(Readable.toWeb(nodeStream) as ReadableStream);
  });

  return route;
}
