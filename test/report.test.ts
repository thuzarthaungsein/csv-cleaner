import { test } from "node:test"
import assert from "node:assert/strict"
import { Hono } from "hono"
import { buildReportRoute } from "../src/routes/report.js"
import { createJob, completeJob } from "../src/repositories/job.js"

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
