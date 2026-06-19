import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cleanCsv } from "../src/services/cleaner.js"

test("cleanCsv trims, lowercases emails, dedupes, and nulls empty strings", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "csv-cleaner-test-"))
    try {
        const result = await cleanCsv("test/fixtures/dirty.csv", outputDir)

        assert.equal(result.rowCountBefore, 5)
        assert.equal(result.rowCountAfter, 4)
        assert.ok(result.outputPath.endsWith("dirty_cleaned.csv"))

        const contents = await readFile(result.outputPath, "utf-8")
        assert.ok(contents.includes("alice@example.com"))
        assert.ok(!contents.includes("  Alice  "))
        assert.ok(contents.includes("Alice"))
    } finally {
        await rm(outputDir, { recursive: true, force: true })
    }
})
