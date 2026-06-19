import { test } from "node:test"
import assert from "node:assert/strict"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runPipeline } from "../src/agents/dataCleaner.js"
import { buildCountryCache } from "../src/services/enricher.js"
import { getJob } from "../src/repositories/job.js"

test("runPipeline runs full pipeline end to end and marks job done", async () => {
    const uploadDir = await mkdtemp(join(tmpdir(), "csv-cleaner-upload-"))
    const uploadPath = join(uploadDir, "valid.csv")
    await copyFile("test/fixtures/valid.csv", uploadPath)

    try {
        const cache = buildCountryCache([])
        const result = await runPipeline(uploadPath, cache)

        assert.equal(result.status, "done")
        const job = await getJob(result.jobId)
        assert.equal(job?.status, "done")
        assert.equal(job?.row_count_before, 3)
    } finally {
        await rm(uploadDir, { recursive: true, force: true })
    }
})

test("runPipeline marks job failed when the input file does not exist", async () => {
    const result = await runPipeline("uploads/does-not-exist.csv", buildCountryCache([]))
    assert.equal(result.status, "failed")
    const job = await getJob(result.jobId)
    assert.equal(job?.status, "failed")
    assert.ok(job?.error_message)
})
