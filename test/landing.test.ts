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
