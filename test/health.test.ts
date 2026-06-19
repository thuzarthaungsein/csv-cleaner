import { test } from "node:test"
import assert from "node:assert/strict"
import { Hono } from "hono"

function buildHealthApp() {
    const app = new Hono()
    app.get("/health", (c) => c.json({ status: "ok" }))
    return app
}

test("GET /health returns status ok", async () => {
    const app = buildHealthApp()
    const res = await app.request("/health")
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.deepEqual(body, { status: "ok" })
})
