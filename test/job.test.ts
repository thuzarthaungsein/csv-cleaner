import { test } from "node:test"
import assert from "node:assert/strict"
import { createJob, updateJobStatus, completeJob, failJob, getJob } from "../src/repositories/job.js"

test("createJob inserts a pending job and getJob retrieves it", async () => {
    const job = await createJob("sample.csv")
    assert.equal(job.file_name, "sample.csv")
    assert.equal(job.status, "pending")

    const fetched = await getJob(job.id)
    assert.ok(fetched)
    assert.equal(fetched?.id, job.id)
})

test("updateJobStatus advances status", async () => {
    const job = await createJob("sample2.csv")
    await updateJobStatus(job.id, "validated")
    const fetched = await getJob(job.id)
    assert.equal(fetched?.status, "validated")
})

test("completeJob sets final fields and status done", async () => {
    const job = await createJob("sample3.csv")
    await completeJob(job.id, {
        rowCountBefore: 10,
        rowCountAfter: 8,
        enrichedApi: "restcountries.com/v3.1",
        enrichedColumns: ["region", "cca3"],
        skippedRows: 1,
    })
    const fetched = await getJob(job.id)
    assert.equal(fetched?.status, "done")
    assert.equal(fetched?.row_count_before, 10)
    assert.equal(fetched?.row_count_after, 8)
    assert.equal(fetched?.enriched_columns, "region,cca3")
    assert.equal(fetched?.skipped_rows, 1)
})

test("failJob sets status failed and error_message", async () => {
    const job = await createJob("sample4.csv")
    await failJob(job.id, "boom")
    const fetched = await getJob(job.id)
    assert.equal(fetched?.status, "failed")
    assert.equal(fetched?.error_message, "boom")
})

test("getJob returns null for missing id", async () => {
    const fetched = await getJob(999999)
    assert.equal(fetched, null)
})
