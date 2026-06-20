import { test } from "node:test"
import assert from "node:assert/strict"
import { validateCsv } from "../src/services/validator.js"

test("validateCsv reports a clean file as valid with correct row count", async () => {
    const result = await validateCsv("test/fixtures/valid.csv")
    assert.equal(result.valid, true)
    assert.equal(result.rowCount, 3)
    assert.deepEqual(result.errors, [])
})

test("validateCsv detects a fully-duplicate row and a date type mismatch", async () => {
    const result = await validateCsv("test/fixtures/invalid.csv")
    assert.equal(result.valid, false)
    assert.equal(result.rowCount, 5)

    const dupError = result.errors.find((e) => e.column === "*" && e.issue === "duplicate_row")
    assert.ok(dupError, "expected a duplicate_row error with column '*'")
    assert.equal(dupError?.count, 2)

    const dateWarning = result.warnings.find((w) => w.column === "signup_date" && w.issue === "type_mismatch")
    assert.ok(dateWarning, "expected a type_mismatch warning for signup_date column")

    const emptyColumnError = result.errors.find((e) => e.issue === "empty_column")
    assert.equal(emptyColumnError, undefined, "no column in invalid.csv is fully empty")
})

test("validateCsv reports an empty_column error for a fully-empty column", async () => {
    const result = await validateCsv("test/fixtures/empty-column.csv")
    assert.equal(result.valid, false)

    const emptyError = result.errors.find((e) => e.column === "notes" && e.issue === "empty_column")
    assert.ok(emptyError, "expected an empty_column error for notes column")
    assert.equal(emptyError?.count, 3)

    const highNullWarning = result.warnings.find((w) => w.column === "notes" && w.issue === "high_null_ratio")
    assert.equal(highNullWarning, undefined, "empty_column and high_null_ratio must be mutually exclusive")
})

test("validateCsv reports high_null_ratio warning when a column is more than half null but not fully empty", async () => {
    const result = await validateCsv("test/fixtures/high-null.csv")
    assert.equal(result.valid, true, "high_null_ratio is a warning, not an error")

    const warning = result.warnings.find((w) => w.column === "notes" && w.issue === "high_null_ratio")
    assert.ok(warning, "expected a high_null_ratio warning for notes column")
    assert.equal(warning?.count, 3)
})

test("validateCsv reports numeric_mismatch warning when a VARCHAR column is mostly numeric-looking", async () => {
    const result = await validateCsv("test/fixtures/numeric-mismatch.csv")

    const warning = result.warnings.find((w) => w.column === "score" && w.issue === "numeric_mismatch")
    assert.ok(warning, "expected a numeric_mismatch warning for score column")
    assert.equal(warning?.count, 1)
})

test("validateCsv sums duplicate row counts across multiple duplicate groups", async () => {
    const result = await validateCsv("test/fixtures/multi-duplicate.csv")
    assert.equal(result.valid, false)

    const dupError = result.errors.find((e) => e.column === "*" && e.issue === "duplicate_row")
    assert.ok(dupError, "expected a duplicate_row error with column '*'")
    // one group of 3 (Bob) + one group of 2 (Dave) = 5 duplicate rows total
    assert.equal(dupError?.count, 5)
})
