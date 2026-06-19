import { test } from "node:test"
import assert from "node:assert/strict"
import { validateCsv } from "../src/services/validator.js"

test("validateCsv reports a clean file as valid with correct row count", async () => {
    const result = await validateCsv("test/fixtures/valid.csv")
    assert.equal(result.valid, true)
    assert.equal(result.rowCount, 3)
    assert.deepEqual(result.errors, [])
})

test("validateCsv detects nulls, duplicate ids, and type mismatch", async () => {
    const result = await validateCsv("test/fixtures/invalid.csv")
    assert.equal(result.valid, false)
    assert.equal(result.rowCount, 4)

    const nullError = result.errors.find((e) => e.column === "name" && e.issue === "null_value")
    assert.ok(nullError, "expected a null_value error for name column")
    assert.equal(nullError?.count, 1)

    const dupError = result.errors.find((e) => e.column === "id" && e.issue === "duplicate_row")
    assert.ok(dupError, "expected a duplicate_row error for id column")
    assert.equal(dupError?.count, 1)

    const typeWarning = result.warnings.find((w) => w.column === "signup_date" && w.issue === "type_mismatch")
    assert.ok(typeWarning, "expected a type_mismatch warning for signup_date column")
})
