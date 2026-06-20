import { Hono } from "hono"
import { getJob } from "../repositories/job.js"
import type { Job } from "../repositories/job.js"

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
}

function renderInProgress(job: Job): string {
    const fileName = escapeHtml(job.file_name)
    const status = escapeHtml(job.status)
    const errorMessage = escapeHtml(job.error_message ?? "")

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
</html>`
}

function renderDone(job: Job): string {
    const fileName = escapeHtml(job.file_name)
    const status = escapeHtml(job.status)
    const rowBefore = job.row_count_before ?? 0
    const rowAfter = job.row_count_after ?? 0
    const skipped = job.skipped_rows ?? 0
    const coverage = rowAfter > 0 ? Math.round(((rowAfter - skipped) / rowAfter) * 100) : 0
    const enrichedColumns = escapeHtml(job.enriched_columns ?? "none")

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Report - Job ${job.id}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-gray-50 p-8">
    <div class="max-w-3xl mx-auto space-y-6">
        <h1 class="text-2xl font-bold">Report: ${fileName}</h1>

        <table class="w-full bg-white rounded-lg shadow text-left">
            <tbody>
                <tr class="border-b"><th class="p-3">Status</th><td class="p-3">${status}</td></tr>
                <tr class="border-b"><th class="p-3">Filename</th><td class="p-3">${fileName}</td></tr>
                <tr class="border-b"><th class="p-3">Row count before</th><td class="p-3">${rowBefore}</td></tr>
                <tr class="border-b"><th class="p-3">Row count after</th><td class="p-3">${rowAfter}</td></tr>
                <tr class="border-b"><th class="p-3">Enriched columns</th><td class="p-3">${enrichedColumns}</td></tr>
                <tr><th class="p-3">Skipped rows</th><td class="p-3">${skipped}</td></tr>
            </tbody>
        </table>

        <div class="bg-white rounded-lg shadow p-4">
            <canvas id="rowCountChart"></canvas>
        </div>
        <div class="bg-white rounded-lg shadow p-4">
            <canvas id="coverageChart"></canvas>
        </div>
    </div>

    <script>
        new Chart(document.getElementById("rowCountChart"), {
            type: "bar",
            data: {
                labels: ["Before", "After"],
                datasets: [{ label: "Row count", data: [${rowBefore}, ${rowAfter}], backgroundColor: ["#94a3b8", "#3b82f6"] }],
            },
        })
        new Chart(document.getElementById("coverageChart"), {
            type: "bar",
            data: {
                labels: ["Enrichment coverage %"],
                datasets: [{ label: "Coverage", data: [${coverage}], backgroundColor: ["#22c55e"] }],
            },
            options: { scales: { y: { max: 100 } } },
        })
    </script>
</body>
</html>`
}

export function buildReportRoute() {
    const route = new Hono()

    route.get("/:id", async (c) => {
        const id = Number(c.req.param("id"))
        const job = await getJob(id)

        if (!job) {
            return c.json({ error: "job not found" }, 404)
        }

        const html = job.status === "done" ? renderDone(job) : renderInProgress(job)

        return c.html(html)
    })

    return route
}
