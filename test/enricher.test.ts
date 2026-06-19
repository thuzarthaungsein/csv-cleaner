import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildCountryCache, enrichCsv } from "../src/services/enricher.js"
import type { CountryRecord } from "../src/services/enricher.js"

const FIXTURE_COUNTRIES: CountryRecord[] = [
    { name: "United States", cca2: "US", cca3: "USA", region: "Americas" },
    { name: "France", cca2: "FR", cca3: "FRA", region: "Europe" },
]

test("enrichCsv joins on country name or ISO code and tracks skipped rows", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "csv-cleaner-test-"))
    try {
        const cache = buildCountryCache(FIXTURE_COUNTRIES)
        const result = await enrichCsv("test/fixtures/with_country.csv", outputDir, cache)

        assert.equal(result.enriched, true)
        assert.equal(result.matchedRows, 2)
        assert.equal(result.skippedRows, 1)
        assert.deepEqual(result.enrichedColumns, ["region", "cca3"])

        const contents = await readFile(result.outputPath, "utf-8")
        assert.ok(contents.includes("Americas"))
        assert.ok(contents.includes("Europe"))
    } finally {
        await rm(outputDir, { recursive: true, force: true })
    }
})

test("enrichCsv skips gracefully when no country column is present", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "csv-cleaner-test-"))
    try {
        const cache = buildCountryCache(FIXTURE_COUNTRIES)
        const result = await enrichCsv("test/fixtures/no_country.csv", outputDir, cache)

        assert.equal(result.enriched, false)
        assert.equal(result.matchedRows, 0)
        assert.equal(result.skippedRows, 0)
        assert.deepEqual(result.enrichedColumns, [])
    } finally {
        await rm(outputDir, { recursive: true, force: true })
    }
})

test("enrichCsv skips gracefully when the cache is empty", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "csv-cleaner-test-"))
    try {
        const emptyCache = buildCountryCache([])
        const result = await enrichCsv("test/fixtures/with_country.csv", outputDir, emptyCache)

        assert.equal(result.enriched, false)
        assert.equal(result.matchedRows, 0)
    } finally {
        await rm(outputDir, { recursive: true, force: true })
    }
})
