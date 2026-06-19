import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile, rm } from "node:fs/promises"
import { buildUploadRoute } from "../src/routes/upload.js"
import { Hono } from "hono"
import { buildCountryCache } from "../src/services/enricher.js"

test("POST /upload accepts a multipart CSV and returns a job id", async () => {
    const app = new Hono()
    app.route("/upload", buildUploadRoute(buildCountryCache([])))

    const csvContents = await readFile("test/fixtures/valid.csv")
    const formData = new FormData()
    formData.append("file", new Blob([csvContents], { type: "text/csv" }), "valid.csv")

    const res = await app.request("/upload", {
        method: "POST",
        body: formData,
    })
    const body = await res.json()

    assert.equal(res.status, 200)
    assert.equal(typeof body.jobId, "number")
    assert.equal(body.status, "done")

    await rm(`uploads/${body.fileName}`, { force: true }).catch(() => {})
})
