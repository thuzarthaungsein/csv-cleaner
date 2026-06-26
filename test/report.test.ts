import { test } from "node:test"
import assert from "node:assert/strict"
import { Hono } from "hono"
import { buildReportRoute } from "../src/routes/report.js"
import { createJob, completeJob } from "../src/repositories/job.js"
import { mkdir, writeFile, rm } from "node:fs/promises"

test("GET /report/:id returns 404 for missing job", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const res = await app.request("/report/999999")
    assert.equal(res.status, 404)
})

test("GET /report/:id renders status banner for a pending job", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const job = await createJob("pending_job.csv")

    const res = await app.request(`/report/${job.id}`)
    const html = await res.text()
    assert.equal(res.status, 200)
    assert.ok(html.includes("pending"))
    assert.ok(!html.includes("Chart("))
})

test("GET /report/:id escapes HTML-dangerous filenames", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const job = await createJob("<script>alert(1)</script>.csv")

    const res = await app.request(`/report/${job.id}`)
    const html = await res.text()
    assert.equal(res.status, 200)
    assert.ok(!html.includes("<script>alert(1)</script>"))
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"))
})

test("GET /report/:id renders charts and summary table for a done job", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const job = await createJob("done_job.csv")
    await completeJob(job.id, {
        rowCountBefore: 10,
        rowCountAfter: 8,
        enrichedApi: "restcountries.com/v3.1",
        enrichedColumns: ["region", "cca3"],
        skippedRows: 1,
    })

    const res = await app.request(`/report/${job.id}`)
    const html = await res.text()
    assert.equal(res.status, 200)
    assert.ok(html.includes("done_job.csv"))
    assert.ok(html.includes("Chart("))
    assert.ok(html.includes("tailwindcss"))
})

test("GET /report/:id shows not-enriched message instead of a misleading coverage chart", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const job = await createJob("no_country_job.csv")
    await completeJob(job.id, {
        rowCountBefore: 10,
        rowCountAfter: 8,
        enrichedApi: null,
        enrichedColumns: [],
        skippedRows: 0,
    })

    const res = await app.request(`/report/${job.id}`)
    const html = await res.text()
    assert.equal(res.status, 200)
    assert.ok(html.includes("Not enriched (no country column detected)"))
    assert.ok(!html.includes("coverageChart"))
})

test("GET /report/:id/download returns 404 for missing job", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const res = await app.request("/report/999999/download")
    assert.equal(res.status, 404)
})

test("GET /report/:id/download returns 400 for a job that is not done", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const job = await createJob("pending_download.csv")

    const res = await app.request(`/report/${job.id}/download`)
    assert.equal(res.status, 400)
})

test("GET /report/:id/download streams the output file with correct headers", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    await mkdir("outputs", { recursive: true })
    const outputPath = "outputs/download_test_enriched.csv"
    await writeFile(outputPath, "id,name\n1,Alice\n")

    const job = await createJob("download_test.csv")
    await completeJob(job.id, {
        rowCountBefore: 1,
        rowCountAfter: 1,
        enrichedApi: "mledoze/countries",
        enrichedColumns: ["region", "cca3"],
        skippedRows: 0,
        outputPath,
    })

    try {
        const res = await app.request(`/report/${job.id}/download`)
        assert.equal(res.status, 200)
        assert.equal(res.headers.get("content-type"), "text/csv")
        assert.ok(res.headers.get("content-disposition")?.includes("download_test_enriched.csv"))
        const body = await res.text()
        assert.equal(body, "id,name\n1,Alice\n")
    } finally {
        await rm(outputPath, { force: true })
    }
})

test("GET /report/:id/download returns 404 when the output file is missing from disk", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const job = await createJob("missing_output.csv")
    await completeJob(job.id, {
        rowCountBefore: 1,
        rowCountAfter: 1,
        enrichedApi: null,
        enrichedColumns: [],
        skippedRows: 0,
        outputPath: "outputs/this_file_does_not_exist_cleaned.csv",
    })

    const res = await app.request(`/report/${job.id}/download`)
    assert.equal(res.status, 404)
})
