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

test("POST /upload sanitizes a path-traversal filename and stays within uploads/", async () => {
    const app = new Hono()
    app.route("/upload", buildUploadRoute(buildCountryCache([])))

    const csvContents = await readFile("test/fixtures/valid.csv")
    const formData = new FormData()
    formData.append("file", new Blob([csvContents], { type: "text/csv" }), "../../etc/passwd")

    const res = await app.request("/upload", {
        method: "POST",
        body: formData,
    })
    const body = await res.json()

    assert.equal(res.status, 200)
    assert.equal(body.fileName.includes(".."), false)
    assert.equal(body.fileName.includes("/"), false)

    const written = await readFile(`uploads/${body.fileName}`).catch(() => null)
    assert.ok(written, "expected sanitized file to be written inside uploads/")

    await rm(`uploads/${body.fileName}`, { force: true }).catch(() => {})
})

test("POST /upload returns 500 with errorMessage when the pipeline fails", async () => {
    const app = new Hono()
    app.route("/upload", buildUploadRoute(buildCountryCache([])))

    const csvContents = await readFile("test/fixtures/empty-column.csv")
    const formData = new FormData()
    formData.append("file", new Blob([csvContents], { type: "text/csv" }), "empty-column.csv")

    const res = await app.request("/upload", {
        method: "POST",
        body: formData,
    })
    const body = await res.json()

    assert.equal(res.status, 500)
    assert.equal(body.status, "failed")
    assert.ok(body.errorMessage)

    await rm(`uploads/${body.fileName}`, { force: true }).catch(() => {})
})
