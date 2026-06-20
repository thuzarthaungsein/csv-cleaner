# Dynamic Validator/Cleaner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `validator.ts`'s hardcoded `id`/`name`/`email` schema with fully dynamic, schema-agnostic validation, and align `cleaner.ts`'s dedupe/email-detection logic with the same dynamic approach.

**Architecture:** `validator.ts` and `cleaner.ts` stay pure DuckDB services with the same exported function signatures (`validateCsv(filePath): Promise<ValidationResult>`, `cleanCsv(filePath, outputDir): Promise<CleanResult>`) — only their internal logic and the shape of individual `ValidationError`/`ValidationWarning` entries change. Downstream consumers (`dataCleaner.ts`, routes) are unaffected since they only branch on `valid`/`status`, never on specific error/warning shapes.

**Tech Stack:** DuckDB via `duckdb-async`, Node's built-in test runner (`node:test`), TypeScript.

## Global Constraints

- snake_case for DB fields/columns, camelCase for variables/functions, PascalCase for classes
- 4-space indent, no semicolons, trailing commas allowed
- `src/services/*` — DuckDB logic only, no Postgres calls
- Never mutate the source CSV file being validated or cleaned
- `ValidationResult` output contract stays `{ valid, rowCount, errors: ValidationError[], warnings: ValidationWarning[] }`
- Empty-column error and high-null-ratio warning are mutually exclusive per column (a 100%-null column gets only the error)
- Duplicate-row check is full-row comparison (no single dedupe key); reported with `column: "*"`
- Numeric-mismatch warning threshold: ≥90% of a VARCHAR column's non-null values match `^-?\d+(\.\d+)?$`
- Date-mismatch warning (VARCHAR column with "date" in its name) stays as an independent, unchanged rule
- Cleaner's email-detection is an exact case-insensitive match against `["email", "e_mail", "email_address"]`, not a substring match
- README.md must never contain literal environment-variable example values (even placeholder-looking ones) — only variable names, descriptions, and a pointer to `.env.example`

---

## Task 1: Rewrite `validator.ts` with dynamic checks

**Files:**
- Modify: `src/services/validator.ts` (full rewrite of the check logic; keep imports and interfaces' shape)
- Modify: `test/validator.test.ts` (full rewrite of test cases)
- Create: `test/fixtures/empty-column.csv` (replaces the role of `test/fixtures/missing-column.csv`)
- Modify: `test/fixtures/invalid.csv` (adjust so it still exercises a duplicate-row + null + numeric/date mismatch under the new rules)
- Delete: `test/fixtures/missing-column.csv` (superseded by `empty-column.csv`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (unchanged export signatures, changed internal issue shapes consumers must NOT assume specific column names for):
  ```typescript
  export interface ValidationError {
      column: string
      issue: string
      count: number
  }

  export interface ValidationWarning {
      column: string
      issue: string
  }

  export interface ValidationResult {
      valid: boolean
      rowCount: number
      errors: ValidationError[]
      warnings: ValidationWarning[]
  }

  export async function validateCsv(filePath: string): Promise<ValidationResult>
  ```
  Possible `issue` values now: `"empty_column"`, `"high_null_ratio"`, `"duplicate_row"` (errors); `"numeric_mismatch"`, `"type_mismatch"` (warnings, both date-name-heuristic).
  Task 2 (`cleaner.ts`) does not consume `validator.ts`'s output. Task 3 (fixture/test cleanup for `dataCleaner.test.ts`/`upload.test.ts`) consumes `test/fixtures/empty-column.csv` created in this task.

- [ ] **Step 1: Update `test/fixtures/invalid.csv` so it still exercises null, duplicate, and mismatch checks under the new dynamic rules**

Replace the contents of `test/fixtures/invalid.csv`:
```csv
id,name,email,signup_date
1,Alice,alice@example.com,2024-01-15
2,Bob,bob@example.com,2024-02-20
2,Bob,bob@example.com,2024-02-20
3,Carol,not-an-email,bad-date
4,,dave@example.com,2024-04-10
```
This file now has: a fully-duplicate row (rows 2 and 3, both `2,Bob,bob@example.com,2024-02-20` — every column matches), a null `name` in row 5 (1 of 5 = 20% null, under the 50% warning threshold, so `name` gets no finding), and `signup_date` is a VARCHAR column (forced by `bad-date`) whose name contains "date", triggering the unchanged date-mismatch warning.

- [ ] **Step 2: Create `test/fixtures/empty-column.csv`**

```csv
id,name,email,notes
1,Alice,alice@example.com,
2,Bob,bob@example.com,
3,Carol,carol@example.com,
```
The `notes` column is 100% empty — this exercises the new `empty_column` error. The other three columns are fully populated and have no duplicates, so this file's ONLY finding is the `empty_column` error on `notes`.

- [ ] **Step 3: Delete `test/fixtures/missing-column.csv`**

Run: `rm test/fixtures/missing-column.csv`

- [ ] **Step 4: Write the failing test**

Replace the entire contents of `test/validator.test.ts`:
```typescript
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
    assert.equal(dupError?.count, 1)

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
```

- [ ] **Step 5: Create the two new fixtures the test references**

`test/fixtures/high-null.csv`:
```csv
id,name,notes
1,Alice,
2,Bob,
3,Carol,
4,Dave,had a great call
5,Eve,follow up needed
```
`notes` is null in 3 of 5 rows (60% > 50% threshold, but not 100%) — triggers `high_null_ratio`, not `empty_column`.

`test/fixtures/numeric-mismatch.csv`:
```csv
id,name,score
1,Alice,95
2,Bob,88
3,Carol,72
4,Dave,91
5,Eve,not-scored
6,Frank,67
7,Grace,80
8,Heidi,73
9,Ivan,N/A
10,Judy,90
```
`score` is forced to VARCHAR by the two non-numeric values (`not-scored`, `N/A`), but 8 of 10 (80%)... **adjust to meet the ≥90% threshold**: use this version instead so exactly 9 of 10 values are numeric-looking (90%):
```csv
id,name,score
1,Alice,95
2,Bob,88
3,Carol,72
4,Dave,91
5,Eve,65
6,Frank,67
7,Grace,80
8,Heidi,73
9,Ivan,N/A
10,Judy,90
```
9 of 10 values are numeric-looking (90%, meets the ≥90% threshold), 1 (`N/A`) is not — `warning.count` should be `1`.

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `validator.test.ts` tests fail because `validateCsv` doesn't yet emit `empty_column`/`high_null_ratio`/`numeric_mismatch`/`column: "*"` duplicate_row, and `test/fixtures/high-null.csv`/`numeric-mismatch.csv` don't exist as DB queries reference them (or they exist but the implementation doesn't detect the new issue types).

- [ ] **Step 7: Rewrite `src/services/validator.ts`**

Replace the entire file:
```typescript
import { Database } from "duckdb-async"

export interface ValidationError {
    column: string
    issue: string
    count: number
}

export interface ValidationWarning {
    column: string
    issue: string
}

export interface ValidationResult {
    valid: boolean
    rowCount: number
    errors: ValidationError[]
    warnings: ValidationWarning[]
}

function quoteIdent(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`
}

export async function validateCsv(filePath: string): Promise<ValidationResult> {
    const db = await Database.create(":memory:")
    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []

    try {
        const escapedPath = filePath.replace(/'/g, "''")
        const columns = await db.all(
            `DESCRIBE SELECT * FROM read_csv_auto('${escapedPath}')`,
        )
        const columnNames = columns.map((c: Record<string, unknown>) => String(c.column_name))
        const columnTypes = new Map(
            columns.map((c: Record<string, unknown>) => [String(c.column_name), String(c.column_type)]),
        )

        const [{ rowCount }] = await db.all(
            `SELECT COUNT(*)::INT AS "rowCount" FROM read_csv_auto('${escapedPath}')`,
        )

        for (const column of columnNames) {
            const quoted = quoteIdent(column)
            const isVarchar = columnTypes.get(column) === "VARCHAR"
            const nullCondition = isVarchar
                ? `${quoted} IS NULL OR ${quoted} = ''`
                : `${quoted} IS NULL`
            const [{ nullCount }] = await db.all(
                `SELECT COUNT(*)::INT AS "nullCount" FROM read_csv_auto('${escapedPath}') WHERE ${nullCondition}`,
            )

            if (nullCount === rowCount && rowCount > 0) {
                errors.push({ column, issue: "empty_column", count: nullCount })
            } else if (nullCount > rowCount / 2) {
                warnings.push({ column, issue: "high_null_ratio", count: nullCount })
            }
        }

        const quotedColumnList = columnNames.map(quoteIdent).join(", ")
        const [{ dupCount }] = await db.all(`
            SELECT COUNT(*)::INT AS "dupCount" FROM (
                SELECT ${quotedColumnList} FROM read_csv_auto('${escapedPath}')
                GROUP BY ${quotedColumnList}
                HAVING COUNT(*) > 1
            ) AS dups
        `)
        if (dupCount > 0) {
            errors.push({ column: "*", issue: "duplicate_row", count: dupCount })
        }

        for (const [column, type] of columnTypes) {
            if (type !== "VARCHAR") {
                continue
            }
            const quoted = quoteIdent(column)

            if (column.toLowerCase().includes("date")) {
                warnings.push({ column, issue: "type_mismatch" })
            }

            const [{ nonNullCount }] = await db.all(
                `SELECT COUNT(*)::INT AS "nonNullCount" FROM read_csv_auto('${escapedPath}') WHERE ${quoted} IS NOT NULL AND ${quoted} != ''`,
            )
            if (nonNullCount === 0) {
                continue
            }
            const [{ numericCount }] = await db.all(`
                SELECT COUNT(*)::INT AS "numericCount" FROM read_csv_auto('${escapedPath}')
                WHERE regexp_matches(${quoted}, '^-?\\d+(\\.\\d+)?$')
            `)
            const numericRatio = numericCount / nonNullCount
            if (numericRatio >= 0.9 && numericCount < nonNullCount) {
                warnings.push({ column, issue: "numeric_mismatch", count: nonNullCount - numericCount })
            }
        }

        return {
            valid: errors.length === 0,
            rowCount,
            errors,
            warnings,
        }
    } finally {
        await db.close()
    }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `validator.test.ts` tests pass. Total suite count will be lower than before this task since `missing-column.csv`-dependent tests in OTHER files (`dataCleaner.test.ts`, `upload.test.ts`) are not yet fixed — that's Task 3. Confirm specifically that all tests within `test/validator.test.ts` pass; some failures in `dataCleaner.test.ts`/`upload.test.ts` referencing the now-deleted `missing-column.csv` are EXPECTED at this point and will be fixed in Task 3. Run the validator file in isolation to confirm:

Run: `npx tsx --env-file=.env --test test/validator.test.ts`
Expected: PASS (5/5 tests)

- [ ] **Step 9: Run code-reviewer agent and code-review plugin, then commit**

Invoke the `code-reviewer` agent to check this task's changes against the layering rules (no Postgres calls, stays in `src/services/`). Then run the `code-review` plugin. Then:

```bash
git add src/services/validator.ts test/validator.test.ts test/fixtures/invalid.csv test/fixtures/empty-column.csv test/fixtures/high-null.csv test/fixtures/numeric-mismatch.csv
git rm test/fixtures/missing-column.csv
git commit -m "feat: make validator.ts fully dynamic, remove hardcoded schema"
```

---

## Task 2: Update `cleaner.ts` dedupe key and email detection

**Files:**
- Modify: `src/services/cleaner.ts`
- Modify: `test/cleaner.test.ts`
- Modify: `test/fixtures/dirty.csv` (adjust if needed so full-row dedupe still removes exactly one row)

**Interfaces:**
- Consumes: nothing from Task 1 directly (independent file).
- Produces (unchanged export signature):
  ```typescript
  export interface CleanResult {
      outputPath: string
      rowCountBefore: number
      rowCountAfter: number
  }

  export async function cleanCsv(filePath: string, outputDir: string): Promise<CleanResult>
  ```
  No consumer depends on the internal dedupe-key logic — `dataCleaner.ts` only reads `rowCountBefore`/`rowCountAfter`/`outputPath`.

- [ ] **Step 1: Verify `test/fixtures/dirty.csv` still produces the expected dedupe count under full-row comparison**

Current `test/fixtures/dirty.csv`:
```csv
id,name,email,signup_date
1,  Alice  ,ALICE@Example.com,2024-01-15
2,Bob,bob@example.com,2024-02-20
2,Bob,bob@example.com,2024-02-20
3,Carol,carol@example.com,2024-03-10
4,,dave@example.com,2024-04-01
```
Rows 2 and 3 (`2,Bob,bob@example.com,2024-02-20` both) are fully identical across all columns — full-row `DISTINCT` removes one of them, same as the old single-key `DISTINCT ON ("id")` behavior for this particular fixture. No change needed to this fixture; `rowCountBefore: 5`, `rowCountAfter: 4` still holds.

- [ ] **Step 2: Write the failing test for email-detection exact-match behavior**

Add a new test to `test/cleaner.test.ts` (keep the existing test as-is):
```typescript
test("cleanCsv only lowercases columns that exactly match email/e_mail/email_address, not substrings", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "csv-cleaner-test-"))
    try {
        const result = await cleanCsv("test/fixtures/email-like-columns.csv", outputDir)
        const contents = await readFile(result.outputPath, "utf-8")

        assert.ok(contents.includes("alice@example.com"), "exact 'email' column should be lowercased")
        assert.ok(contents.includes("BOB@EXAMPLE.COM"), "'emails_sent' column must NOT be lowercased (not an exact match)")
    } finally {
        await rm(outputDir, { recursive: true, force: true })
    }
})
```

- [ ] **Step 3: Create `test/fixtures/email-like-columns.csv`**

```csv
id,email,emails_sent
1,ALICE@Example.com,BOB@EXAMPLE.COM
2,carol@example.com,DAVE@EXAMPLE.COM
```
The `email` column should get lowercased by the new exact-match rule; `emails_sent` should NOT, since it's not an exact match against `["email", "e_mail", "email_address"]`.

- [ ] **Step 4: Run tests to verify the new test fails**

Run: `npx tsx --env-file=.env --test test/cleaner.test.ts`
Expected: FAIL on the new test — current `lower.includes("email")` logic incorrectly lowercases `emails_sent` too (since it's a fixture not yet created, this will first fail with a file-not-found error from DuckDB; after Step 3 exists, it will fail because `emails_sent` gets wrongly lowercased).

- [ ] **Step 5: Update `src/services/cleaner.ts`**

Replace the entire file:
```typescript
import { Database } from "duckdb-async"
import { basename, extname, join } from "node:path"

export interface CleanResult {
    outputPath: string
    rowCountBefore: number
    rowCountAfter: number
}

const EMAIL_COLUMN_NAMES = ["email", "e_mail", "email_address"]

function quoteIdent(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`
}

export async function cleanCsv(filePath: string, outputDir: string): Promise<CleanResult> {
    const db = await Database.create(":memory:")

    try {
        const escapedInput = filePath.replace(/'/g, "''")

        const [{ rowCountBefore }] = await db.all(
            `SELECT COUNT(*)::INT AS "rowCountBefore" FROM read_csv_auto('${escapedInput}')`,
        )

        const columns = await db.all(
            `DESCRIBE SELECT * FROM read_csv_auto('${escapedInput}')`,
        )
        const columnNames = columns.map((c: Record<string, unknown>) => String(c.column_name))
        const columnTypes = new Map(
            columns.map((c: Record<string, unknown>) => [String(c.column_name), String(c.column_type)]),
        )

        const selectParts = columnNames.map((column) => {
            const lower = column.toLowerCase()
            const isVarchar = columnTypes.get(column) === "VARCHAR"
            const quoted = quoteIdent(column)
            if (EMAIL_COLUMN_NAMES.includes(lower)) {
                return isVarchar
                    ? `NULLIF(LOWER(TRIM(${quoted})), '') AS ${quoted}`
                    : quoted
            }
            if (lower.includes("date")) {
                return isVarchar
                    ? `TRY_CAST(TRIM(${quoted}) AS DATE) AS ${quoted}`
                    : quoted
            }
            return isVarchar
                ? `NULLIF(TRIM(${quoted}), '') AS ${quoted}`
                : quoted
        })

        const baseName = basename(filePath, extname(filePath))
        const outputPath = join(outputDir, `${baseName}_cleaned.csv`)
        const escapedOutput = outputPath.replace(/'/g, "''")

        await db.exec(`
            COPY (
                SELECT DISTINCT ${selectParts.join(", ")}
                FROM read_csv_auto('${escapedInput}')
            ) TO '${escapedOutput}' (HEADER, DELIMITER ',')
        `)

        const [{ rowCountAfter }] = await db.all(
            `SELECT COUNT(*)::INT AS "rowCountAfter" FROM read_csv_auto('${escapedOutput}')`,
        )

        return { outputPath, rowCountBefore, rowCountAfter }
    } finally {
        await db.close()
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx tsx --env-file=.env --test test/cleaner.test.ts`
Expected: PASS (2/2 tests)

- [ ] **Step 7: Run code-reviewer agent and code-review plugin, then commit**

Invoke `code-reviewer` to confirm `cleaner.ts` never writes to `uploads/` and only writes to the passed-in `outputDir`, and that the dedupe logic has no leftover single-key assumptions. Then run `code-review` plugin. Then:

```bash
git add src/services/cleaner.ts test/cleaner.test.ts test/fixtures/email-like-columns.csv
git commit -m "feat: use full-row dedupe and exact email-column matching in cleaner.ts"
```

---

## Task 3: Fix downstream fixture references and README

**Files:**
- Modify: `test/dataCleaner.test.ts`
- Modify: `test/upload.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `test/fixtures/empty-column.csv` (created in Task 1) as the new fixture for "validation fails" test scenarios.
- Produces: nothing consumed by later tasks — this is the final task.

- [ ] **Step 1: Update `test/dataCleaner.test.ts`**

Find this test (currently using the now-deleted `missing-column.csv`):
```typescript
test("runPipeline marks job failed when the CSV fails validation", async () => {
    const uploadDir = await mkdtemp(join(tmpdir(), "csv-cleaner-upload-"))
    const uploadPath = join(uploadDir, "missing-column.csv")
    await copyFile("test/fixtures/missing-column.csv", uploadPath)

    try {
        const result = await runPipeline(uploadPath, buildCountryCache([]))

        assert.equal(result.status, "failed")
        assert.ok(result.errorMessage?.includes("validation failed"))
        const job = await getJob(result.jobId)
        assert.equal(job?.status, "failed")
```
Replace the fixture filename references (keep the rest of the test body identical — only the two lines naming the file change):
```typescript
test("runPipeline marks job failed when the CSV fails validation", async () => {
    const uploadDir = await mkdtemp(join(tmpdir(), "csv-cleaner-upload-"))
    const uploadPath = join(uploadDir, "empty-column.csv")
    await copyFile("test/fixtures/empty-column.csv", uploadPath)

    try {
        const result = await runPipeline(uploadPath, buildCountryCache([]))

        assert.equal(result.status, "failed")
        assert.ok(result.errorMessage?.includes("validation failed"))
        const job = await getJob(result.jobId)
        assert.equal(job?.status, "failed")
```

- [ ] **Step 2: Update `test/upload.test.ts`**

Find:
```typescript
    const csvContents = await readFile("test/fixtures/missing-column.csv")
    const formData = new FormData()
    formData.append("file", new Blob([csvContents], { type: "text/csv" }), "missing-column.csv")
```
Replace with:
```typescript
    const csvContents = await readFile("test/fixtures/empty-column.csv")
    const formData = new FormData()
    formData.append("file", new Blob([csvContents], { type: "text/csv" }), "empty-column.csv")
```

- [ ] **Step 3: Run the full test suite to verify everything passes**

Run: `npm test` (ensure Docker/Postgres is running first — `docker compose ps`, `docker compose up -d` if needed)
Expected: PASS, all tests green, no references to `missing-column.csv` remain anywhere (verify with `grep -rln "missing-column" test/ src/` returning no results).

- [ ] **Step 4: Update README.md — remove "Required CSV columns" table and rewrite Quick Start**

Read the current `README.md` to find the exact "Quick start: try it yourself" section (added in a prior session) and the "Environment variables" section.

Replace the "### 1. Required CSV columns" subsection (which lists `id`/`name`/`email` as required) with:
```markdown
### 1. CSV structure

There's no fixed schema — any CSV works. Validation reacts to data quality, not column names:

- A column that's **completely empty** (every value null/blank) is reported as an error.
- A column where **more than half** its values are null/blank is reported as a warning.
- **Fully duplicate rows** (every column identical) are reported as an error.
- A text column where **90% or more** of values look numeric (but not all) is reported as a warning — usually means a few bad rows broke what should be a numeric column.
- A text column with **"date" in its name** is reported as a warning if it didn't parse as a date.
```

Replace the "### 2. Sample CSV with country enrichment" subsection's lead-in sentence (which says "it has the 3 required columns") with:
```markdown
Save this as `sample.csv` — note there's nothing special about its columns, but it includes a `country` column, which triggers enrichment:
```
(keep the rest of that subsection — the CSV content and explanation of `United States`/`FR`/`Wakanda` — unchanged)

In the "### 5. Try a CSV that fails validation" subsection, replace:
```markdown
`test/fixtures/missing-column.csv` is missing the required `email` column, so validation fails and the job is marked `failed` before clean/enrich ever run:

```bash
curl -X POST -F "file=@test/fixtures/missing-column.csv" http://localhost:3000/upload
```
```
with:
```markdown
`test/fixtures/empty-column.csv` has a column (`notes`) that's completely empty, which fails validation — the job is marked `failed` before clean/enrich ever run:

```bash
curl -X POST -F "file=@test/fixtures/empty-column.csv" http://localhost:3000/upload
```
```

Add this line right after the new "CSV structure" subsection (or right after the bullet list), to cover the spec's note about duplicate detection:
```markdown
Duplicate detection compares the full row — two rows are only flagged as duplicates if every column matches, not just an id-like column.
```

- [ ] **Step 5: Replace the "Environment variables" section to remove all literal example values**

Find the current section:
```markdown
## Environment variables

Defined in `.env.example`:

| Variable       | Description                             | Example value                                            |
| -------------- | ---------------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL` | Postgres connection string used by `pg` | `postgresql://user:user_pass@localhost:5432/csv_cleaner` |
| `PORT`         | Port the Hono server listens on         | `3000`                                                   |
```
Replace with (no example values anywhere, just names + descriptions + a pointer):
```markdown
## Environment variables

Copy `.env.example` to `.env` and fill in your own values — see the Setup section above.

| Variable       | Description                             |
| -------------- | ---------------------------------------- |
| `DATABASE_URL` | Postgres connection string used by `pg` |
| `PORT`         | Port the Hono server listens on         |
```

- [ ] **Step 6: Verify no env values leaked into README.md**

Run: `grep -n "postgresql://\|csv_pass\|thuzar_pass" README.md`
Expected: no output (no matches) — confirms no connection-string-shaped values remain anywhere in the README.

- [ ] **Step 7: Run the full test suite one final time**

Run: `npm test`
Expected: PASS, all tests green.

- [ ] **Step 8: Run code-reviewer agent and code-review plugin, then commit**

Invoke `code-reviewer` for a final pass confirming no stale references to the old hardcoded validator schema remain anywhere in tests or docs. Then run `code-review` plugin. Then:

```bash
git add test/dataCleaner.test.ts test/upload.test.ts README.md
git commit -m "test: update fixtures for dynamic validator, docs: rewrite README CSV/env sections"
```

---

## Self-Review Notes

- Spec coverage: empty-column error, high-null-ratio warning (mutually exclusive with the error), full-row duplicate-row error, numeric-mismatch warning (≥90% threshold), date-mismatch warning kept independent, cleaner full-row dedupe, cleaner exact email-name matching, and the README env-value rule are each covered by a task and a concrete test.
- Type consistency: `ValidationResult`/`ValidationError`/`ValidationWarning`/`CleanResult` signatures are unchanged from before this plan — only internal `issue` string values and per-column logic changed, so no downstream consumer (`dataCleaner.ts`, routes) needs modification, and the plan doesn't touch those files.
- No placeholders: every step has runnable code, exact fixture contents, or an exact command with expected output.
- Numeric-mismatch fixture was double-checked by hand-counting ratios (9/10 = 90%, meets "≥90%" threshold) to avoid an off-by-one that silently fails the threshold check.
