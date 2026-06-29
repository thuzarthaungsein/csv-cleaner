import { test } from "node:test"
import assert from "node:assert/strict"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { runPipeline } from "../src/agents/dataCleaner.js"
import { buildReportRoute } from "../src/routes/report.js"
import { buildCountryCache } from "../src/services/enricher.js"
import type { CountryRecord } from "../src/services/enricher.js"
import { getJob } from "../src/repositories/job.js"

const FIXTURE_COUNTRIES: CountryRecord[] = [
    { name: "United States", cca2: "US", cca3: "USA", region: "Americas" },
    { name: "France", cca2: "FR", cca3: "FRA", region: "Europe" },
]

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

test("runPipeline enriches rows with a populated country cache and persists the result", async () => {
    const uploadDir = await mkdtemp(join(tmpdir(), "csv-cleaner-upload-"))
    const uploadPath = join(uploadDir, "valid_with_country.csv")
    await copyFile("test/fixtures/valid_with_country.csv", uploadPath)

    try {
        const cache = buildCountryCache(FIXTURE_COUNTRIES)
        const result = await runPipeline(uploadPath, cache)

        assert.equal(result.status, "done")
        const job = await getJob(result.jobId)
        assert.equal(job?.status, "done")
        assert.ok(job?.enriched_columns)
        assert.ok(job?.enriched_columns?.includes("region"))
        assert.equal(job?.skipped_rows, 1)
    } finally {
        await rm(uploadDir, { recursive: true, force: true })
    }
})

test("runPipeline persists the cleaned output path when enrichment did not run", async () => {
    const uploadDir = await mkdtemp(join(tmpdir(), "csv-cleaner-upload-"))
    const uploadPath = join(uploadDir, "valid.csv")
    await copyFile("test/fixtures/valid.csv", uploadPath)

    try {
        const result = await runPipeline(uploadPath, buildCountryCache([]))

        assert.equal(result.status, "done")
        const job = await getJob(result.jobId)
        assert.ok(job?.output_path)
        assert.ok(job?.output_path?.endsWith("_cleaned.csv"))
    } finally {
        await rm(uploadDir, { recursive: true, force: true })
    }
})

test("runPipeline persists the enriched output path when enrichment ran", async () => {
    const uploadDir = await mkdtemp(join(tmpdir(), "csv-cleaner-upload-"))
    const uploadPath = join(uploadDir, "valid_with_country.csv")
    await copyFile("test/fixtures/valid_with_country.csv", uploadPath)

    try {
        const cache = buildCountryCache(FIXTURE_COUNTRIES)
        const result = await runPipeline(uploadPath, cache)

        assert.equal(result.status, "done")
        const job = await getJob(result.jobId)
        assert.ok(job?.output_path)
        assert.ok(job?.output_path?.endsWith("_enriched.csv"))
    } finally {
        await rm(uploadDir, { recursive: true, force: true })
    }
})

test("runPipeline output is streamable through the download route", async () => {
    const uploadDir = await mkdtemp(join(tmpdir(), "csv-cleaner-upload-"))
    const uploadPath = join(uploadDir, "valid.csv")
    await copyFile("test/fixtures/valid.csv", uploadPath)

    try {
        const result = await runPipeline(uploadPath, buildCountryCache([]))
        assert.equal(result.status, "done")

        const job = await getJob(result.jobId)
        assert.ok(job?.output_path)

        const app = new Hono()
        app.route("/report", buildReportRoute())

        const res = await app.request(`/report/${result.jobId}/download`)
        assert.equal(res.status, 200)
        assert.equal(res.headers.get("content-type"), "text/csv")

        const body = await res.text()
        assert.ok(body.length > 0)
        assert.ok(body.includes("alice@example.com"))
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

test("runPipeline still completes successfully when the CSV has an empty column, recording the finding", async () => {
    const uploadDir = await mkdtemp(join(tmpdir(), "csv-cleaner-upload-"))
    const uploadPath = join(uploadDir, "empty-column.csv")
    await copyFile("test/fixtures/empty-column.csv", uploadPath)

    try {
        const result = await runPipeline(uploadPath, buildCountryCache([]))

        assert.equal(result.status, "done")
        const job = await getJob(result.jobId)
        assert.equal(job?.status, "done")
        assert.ok(job?.validation_findings)
        const findings = JSON.parse(job!.validation_findings!)
        assert.deepEqual(findings.errors, [{ column: "notes", issue: "empty_column", count: 3 }])
        assert.deepEqual(findings.warnings, [])
    } finally {
        await rm(uploadDir, { recursive: true, force: true })
    }
})

test("runPipeline still completes successfully and dedupes when the CSV has duplicate rows", async () => {
    const uploadDir = await mkdtemp(join(tmpdir(), "csv-cleaner-upload-"))
    const uploadPath = join(uploadDir, "dirty.csv")
    await copyFile("test/fixtures/dirty.csv", uploadPath)

    try {
        const result = await runPipeline(uploadPath, buildCountryCache([]))

        assert.equal(result.status, "done")
        const job = await getJob(result.jobId)
        assert.equal(job?.status, "done")
        assert.equal(job?.row_count_before, 5)
        assert.equal(job?.row_count_after, 4)
        assert.ok(job?.validation_findings)
        const findings = JSON.parse(job!.validation_findings!)
        assert.deepEqual(findings.errors, [{ column: "*", issue: "duplicate_row", count: 2 }])
    } finally {
        await rm(uploadDir, { recursive: true, force: true })
    }
})

test("runPipeline stores null validation_findings for a clean CSV with no issues", async () => {
    const uploadDir = await mkdtemp(join(tmpdir(), "csv-cleaner-upload-"))
    const uploadPath = join(uploadDir, "valid.csv")
    await copyFile("test/fixtures/valid.csv", uploadPath)

    try {
        const result = await runPipeline(uploadPath, buildCountryCache([]))

        assert.equal(result.status, "done")
        const job = await getJob(result.jobId)
        assert.equal(job?.validation_findings, null)
    } finally {
        await rm(uploadDir, { recursive: true, force: true })
    }
})
