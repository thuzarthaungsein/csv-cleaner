# Non-Blocking Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make validation purely informational — `runPipeline` always proceeds to clean/enrich regardless of what `validateCsv` finds, and the report page shows the validation findings (duplicates, empty columns, etc.) alongside the cleaned result instead of rejecting the upload outright.

**Architecture:** Persist `validateCsv`'s `errors`/`warnings` arrays as one JSON column on the `jobs` row (set by `dataCleaner.ts` after validation runs, regardless of `valid`), then render them as extra rows in the existing summary table in `report.ts`. Remove the early-return that currently fails the job when `validation.valid` is `false`.

**Tech Stack:** PostgreSQL (`pg`), DuckDB (`duckdb-async`, unchanged), Hono 4.x, `node:test`.

## Global Constraints

- snake_case for DB fields/columns, camelCase for variables/functions
- `src/repositories/job.ts`, `src/agents/dataCleaner.ts`, `test/job.test.ts`, `test/dataCleaner.test.ts` use NO semicolons, 4-space indent, trailing commas allowed
- `src/routes/report.ts`, `test/report.test.ts` use SEMICOLONS (a prior local deviation) — match each file's existing convention
- `src/repositories/job.ts` is the only file permitted to import `pg`
- `status: "failed"` is reserved exclusively for actual thrown errors (file I/O, DB errors) — never for a validation finding
- A finding's column is rendered in red text if it came from `errors`, amber if from `warnings` — matching the existing red "Skipped rows" convention in `report.ts`
- If `validation_findings` is `null` (no findings at all), no extra rows are rendered — the table looks exactly as it does today for a clean file
- No row-level duplicate data is captured or stored — only counts and column names, consistent with every other finding type

---

## Task 1: Persist validation findings and stop blocking the pipeline

**Files:**
- Modify: `init.sql`
- Modify: `src/repositories/job.ts`
- Modify: `src/agents/dataCleaner.ts`
- Modify: `test/job.test.ts`
- Modify: `test/dataCleaner.test.ts`

**Interfaces:**
- Consumes: `ValidationResult` from `src/services/validator.ts` (unchanged — `{ valid, rowCount, errors: ValidationError[], warnings: ValidationWarning[] }`, where `ValidationError = { column, issue, count }` and `ValidationWarning = { column, issue, count? }`).
- Produces:
  ```typescript
  // job.ts
  export interface Job {
      // ...all existing fields...
      validation_findings: string | null   // NEW — JSON-encoded {errors, warnings}
  }

  export async function completeJob(
      id: number,
      fields: {
          rowCountBefore: number
          rowCountAfter: number
          enrichedApi: string | null
          enrichedColumns: string[]
          skippedRows: number
          outputPath: string
          validationFindings: {
              errors: { column: string; issue: string; count: number }[]
              warnings: { column: string; issue: string; count?: number }[]
          }
      },
  ): Promise<void>
  ```
  Task 2 (`report.ts`) consumes `job.validation_findings` (a JSON string or `null`) from `getJob`'s return value, parsing it back into `{ errors, warnings }`.

- [ ] **Step 1: Add the schema column to `init.sql`**

Append this line after the existing `ALTER TABLE` lines at the end of the file:
```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS validation_findings TEXT;
```

- [ ] **Step 2: Apply the column to the running database**

Run: `docker compose ps` to confirm Postgres is up (`docker compose up -d` if not), then:
```bash
docker exec csv_cleaner_db psql -U thuzar -d csv_cleaner -c "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS validation_findings TEXT;"
```
Expected output: `ALTER TABLE`

Verify: `docker exec csv_cleaner_db psql -U thuzar -d csv_cleaner -c "\d jobs"` shows a `validation_findings` column of type `text`.

- [ ] **Step 3: Write the failing test for `job.ts`**

In `test/job.test.ts`, replace the existing `completeJob` test:
```typescript
test("completeJob sets final fields, output_path, and status done", async () => {
    const job = await createJob("sample3.csv")
    await completeJob(job.id, {
        rowCountBefore: 10,
        rowCountAfter: 8,
        enrichedApi: "restcountries.com/v3.1",
        enrichedColumns: ["region", "cca3"],
        skippedRows: 1,
        outputPath: "outputs/sample3_enriched.csv",
    })
    const fetched = await getJob(job.id)
    assert.equal(fetched?.status, "done")
    assert.equal(fetched?.row_count_before, 10)
    assert.equal(fetched?.row_count_after, 8)
    assert.equal(fetched?.enriched_columns, "region,cca3")
    assert.equal(fetched?.skipped_rows, 1)
    assert.equal(fetched?.output_path, "outputs/sample3_enriched.csv")
})
```
with this version (adds `validationFindings` to the call and asserts the JSON round-trips):
```typescript
test("completeJob sets final fields, output_path, validation findings, and status done", async () => {
    const job = await createJob("sample3.csv")
    await completeJob(job.id, {
        rowCountBefore: 10,
        rowCountAfter: 8,
        enrichedApi: "restcountries.com/v3.1",
        enrichedColumns: ["region", "cca3"],
        skippedRows: 1,
        outputPath: "outputs/sample3_enriched.csv",
        validationFindings: {
            errors: [{ column: "*", issue: "duplicate_row", count: 2 }],
            warnings: [{ column: "signup_date", issue: "type_mismatch" }],
        },
    })
    const fetched = await getJob(job.id)
    assert.equal(fetched?.status, "done")
    assert.equal(fetched?.row_count_before, 10)
    assert.equal(fetched?.row_count_after, 8)
    assert.equal(fetched?.enriched_columns, "region,cca3")
    assert.equal(fetched?.skipped_rows, 1)
    assert.equal(fetched?.output_path, "outputs/sample3_enriched.csv")
    assert.deepEqual(JSON.parse(fetched?.validation_findings ?? "null"), {
        errors: [{ column: "*", issue: "duplicate_row", count: 2 }],
        warnings: [{ column: "signup_date", issue: "type_mismatch" }],
    })
})

test("completeJob stores null validation_findings when there are no findings", async () => {
    const job = await createJob("sample5.csv")
    await completeJob(job.id, {
        rowCountBefore: 3,
        rowCountAfter: 3,
        enrichedApi: null,
        enrichedColumns: [],
        skippedRows: 0,
        outputPath: "outputs/sample5_cleaned.csv",
        validationFindings: { errors: [], warnings: [] },
    })
    const fetched = await getJob(job.id)
    assert.equal(fetched?.validation_findings, null)
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx tsx --env-file=.env --test test/job.test.ts`
Expected: FAIL — TypeScript/runtime error since `completeJob`'s `fields` type doesn't yet accept `validationFindings`, and the column doesn't round-trip a value yet.

- [ ] **Step 5: Update `src/repositories/job.ts`**

Add `validation_findings: string | null` to the `Job` interface, right after `output_path`:
```typescript
export interface Job {
    id: number
    file_name: string
    status: JobStatus
    row_count_before: number | null
    row_count_after: number | null
    enriched_api: string | null
    enriched_columns: string | null
    skipped_rows: number | null
    output_path: string | null
    validation_findings: string | null
    error_message: string | null
    created_at: Date
    updated_at: Date
}
```

Update `completeJob` to accept and persist `validationFindings`:
```typescript
export async function completeJob(
    id: number,
    fields: {
        rowCountBefore: number
        rowCountAfter: number
        enrichedApi: string | null
        enrichedColumns: string[]
        skippedRows: number
        outputPath: string
        validationFindings: {
            errors: { column: string; issue: string; count: number }[]
            warnings: { column: string; issue: string; count?: number }[]
        }
    },
): Promise<void> {
    const hasFindings =
        fields.validationFindings.errors.length > 0 ||
        fields.validationFindings.warnings.length > 0
    const validationFindingsJson = hasFindings
        ? JSON.stringify(fields.validationFindings)
        : null

    await pool.query(
        `UPDATE jobs SET
            status = 'done',
            row_count_before = $1,
            row_count_after = $2,
            enriched_api = $3,
            enriched_columns = $4,
            skipped_rows = $5,
            output_path = $6,
            validation_findings = $7,
            updated_at = NOW()
        WHERE id = $8`,
        [
            fields.rowCountBefore,
            fields.rowCountAfter,
            fields.enrichedApi,
            fields.enrichedColumns.length > 0 ? fields.enrichedColumns.join(",") : null,
            fields.skippedRows,
            fields.outputPath,
            validationFindingsJson,
            id,
        ],
    )
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx tsx --env-file=.env --test test/job.test.ts`
Expected: PASS (6/6 tests)

- [ ] **Step 7: Update `src/agents/dataCleaner.ts` to stop blocking on validation and pass findings through**

Find the existing block:
```typescript
    try {
        const validation = await validateCsv(filePath)
        await updateJobStatus(job.id, "validated")

        if (!validation.valid) {
            const message = `validation failed: ${JSON.stringify(validation.errors)}`
            await failJob(job.id, message)
            return { jobId: job.id, status: "failed", errorMessage: message }
        }

        await mkdir(OUTPUT_DIR, { recursive: true })
```
Replace it with (removes the early-return entirely; validation always proceeds):
```typescript
    try {
        const validation = await validateCsv(filePath)
        await updateJobStatus(job.id, "validated")

        await mkdir(OUTPUT_DIR, { recursive: true })
```

Find the existing `completeJob` call:
```typescript
        await completeJob(job.id, {
            rowCountBefore: validation.rowCount,
            rowCountAfter: cleanResult.rowCountAfter,
            enrichedApi: enrichResult.enriched ? "mledoze/countries" : null,
            enrichedColumns: enrichResult.enrichedColumns,
            skippedRows: enrichResult.skippedRows,
            outputPath: finalOutputPath,
        })
```
Replace it with (adds `validationFindings`):
```typescript
        await completeJob(job.id, {
            rowCountBefore: validation.rowCount,
            rowCountAfter: cleanResult.rowCountAfter,
            enrichedApi: enrichResult.enriched ? "mledoze/countries" : null,
            enrichedColumns: enrichResult.enrichedColumns,
            skippedRows: enrichResult.skippedRows,
            outputPath: finalOutputPath,
            validationFindings: { errors: validation.errors, warnings: validation.warnings },
        })
```

The full updated `runPipeline` function body should now read:
```typescript
export async function runPipeline(
    filePath: string,
    countryCache: Map<string, CountryRecord>,
): Promise<PipelineResult> {
    // No job id exists yet, so a createJob failure cannot be recorded via failJob.
    // Callers (e.g. the future upload route) should expect runPipeline to potentially reject if job creation itself fails.
    const job = await createJob(basename(filePath))

    try {
        const validation = await validateCsv(filePath)
        await updateJobStatus(job.id, "validated")

        await mkdir(OUTPUT_DIR, { recursive: true })
        const cleanResult = await cleanCsv(filePath, OUTPUT_DIR)
        await updateJobStatus(job.id, "cleaned")

        const enrichResult = await enrichCsv(cleanResult.outputPath, OUTPUT_DIR, countryCache)
        if (enrichResult.enriched) {
            await updateJobStatus(job.id, "enriched")
        }

        const finalOutputPath = enrichResult.enriched
            ? enrichResult.outputPath
            : cleanResult.outputPath

        await completeJob(job.id, {
            rowCountBefore: validation.rowCount,
            rowCountAfter: cleanResult.rowCountAfter,
            enrichedApi: enrichResult.enriched ? "mledoze/countries" : null,
            enrichedColumns: enrichResult.enrichedColumns,
            skippedRows: enrichResult.skippedRows,
            outputPath: finalOutputPath,
            validationFindings: { errors: validation.errors, warnings: validation.warnings },
        })

        return { jobId: job.id, status: "done" }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        try {
            await failJob(job.id, message)
        } catch (secondaryError) {
            console.error("failJob threw while handling pipeline error:", secondaryError)
        }
        return { jobId: job.id, status: "failed", errorMessage: message }
    }
}
```

`failJob` is still imported and used (for the genuine-exception `catch` block) — do not remove that import.

- [ ] **Step 8: Replace the now-stale validation-blocking test in `test/dataCleaner.test.ts`**

Find and remove this entire test (it asserts the old blocking behavior, which no longer exists):
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
        assert.ok(job?.error_message)
    } finally {
        await rm(uploadDir, { recursive: true, force: true })
    }
})
```

Replace it with three new tests covering the new behavior:
```typescript
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
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx tsx --env-file=.env --test test/dataCleaner.test.ts`
Expected: PASS (9/9 tests). The file had 7 tests before this step; Step 8 removed 1 (the stale blocking test) and added 3, for a net of 7 - 1 + 3 = 9.

- [ ] **Step 10: Run the full test suite**

Run: `npm test` (ensure `docker compose ps` shows Postgres running first, `docker compose up -d` if not)
Expected: PASS (45/45 tests: 42 before this task, +1 net in `job.test.ts`, +2 net in `dataCleaner.test.ts`).

- [ ] **Step 11: Run code-reviewer agent and code-review plugin, then commit**

Invoke the `code-reviewer` agent to confirm `job.ts` remains the only file importing `pg`, that `dataCleaner.ts` makes no direct DB/DuckDB calls of its own, and that `failJob` is still correctly reserved for genuine exceptions only (verify no remaining code path calls `failJob` for a validation finding). Then run the `code-review` plugin. Then commit with a short single-line message:

```bash
git add init.sql src/repositories/job.ts src/agents/dataCleaner.ts test/job.test.ts test/dataCleaner.test.ts
git commit -m "feat: make validation non-blocking, persist findings on job completion"
```

---

## Task 2: Render validation findings in the report

**Files:**
- Modify: `src/routes/report.ts`
- Modify: `test/report.test.ts`

**Interfaces:**
- Consumes: `job.validation_findings` (a JSON string or `null`) from `getJob`'s return value, added in Task 1.
- Produces: nothing consumed by other tasks — this is the final task. `renderReportFragment`'s returned `html` now includes the findings rows when present; its `chartData` shape is unchanged from before this plan.

- [ ] **Step 1: Write the failing tests**

Add these tests to `test/report.test.ts`, after the existing "GET /report/:id/fragment reflects not-enriched jobs in chartData" test (the file already imports `Hono`, `buildReportRoute`, `createJob`, `completeJob`, `mkdir`, `writeFile`, `rm` — no new imports needed):

```typescript
test("GET /report/:id shows validation error and warning rows when findings are present", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const job = await createJob("findings_job.csv")
    await completeJob(job.id, {
        rowCountBefore: 5,
        rowCountAfter: 4,
        enrichedApi: null,
        enrichedColumns: [],
        skippedRows: 0,
        outputPath: "outputs/findings_job_cleaned.csv",
        validationFindings: {
            errors: [{ column: "*", issue: "duplicate_row", count: 2 }],
            warnings: [{ column: "signup_date", issue: "type_mismatch" }],
        },
    })

    const res = await app.request(`/report/${job.id}`)
    const html = await res.text()
    assert.equal(res.status, 200)
    assert.ok(html.includes("Duplicate rows found"))
    assert.ok(html.includes("text-red-600"))
    assert.ok(html.includes("signup_date"))
    assert.ok(html.includes("text-amber-600"))
})

test("GET /report/:id shows no findings rows when validation_findings is null", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const job = await createJob("clean_job.csv")
    await completeJob(job.id, {
        rowCountBefore: 3,
        rowCountAfter: 3,
        enrichedApi: null,
        enrichedColumns: [],
        skippedRows: 0,
        outputPath: "outputs/clean_job_cleaned.csv",
        validationFindings: { errors: [], warnings: [] },
    })

    const res = await app.request(`/report/${job.id}`)
    const html = await res.text()
    assert.equal(res.status, 200)
    assert.ok(!html.includes("Duplicate rows found"))
    assert.ok(!html.includes("Empty column"));
    assert.ok(!html.includes("type_mismatch"));
})

test("GET /report/:id shows an empty_column finding with the column name", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const job = await createJob("empty_col_job.csv")
    await completeJob(job.id, {
        rowCountBefore: 3,
        rowCountAfter: 3,
        enrichedApi: null,
        enrichedColumns: [],
        skippedRows: 0,
        outputPath: "outputs/empty_col_job_cleaned.csv",
        validationFindings: {
            errors: [{ column: "notes", issue: "empty_column", count: 3 }],
            warnings: [],
        },
    })

    const res = await app.request(`/report/${job.id}`)
    const html = await res.text()
    assert.equal(res.status, 200)
    assert.ok(html.includes("Empty column"))
    assert.ok(html.includes("notes"))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --env-file=.env --test test/report.test.ts`
Expected: FAIL — `renderReportFragment` doesn't render any findings rows yet, so all 3 new tests fail (the second one, asserting absence, may pass trivially since nothing is rendered yet either way — but it will become a real check once Step 3 is implemented; verify all three again after Step 3).

- [ ] **Step 3: Implement findings rendering in `src/routes/report.ts`**

Add this helper function after `buildDownloadFileName` and before `renderInProgress` (this file uses semicolons — match that):

```typescript
interface ValidationFinding {
  column: string;
  issue: string;
  count?: number;
}

interface ValidationFindings {
  errors: ValidationFinding[];
  warnings: ValidationFinding[];
}

const ISSUE_LABELS: Record<string, string> = {
  empty_column: "Empty column",
  duplicate_row: "Duplicate rows found",
  high_null_ratio: "High null ratio",
  numeric_mismatch: "Mostly numeric, has non-numeric values",
  type_mismatch: "Looks like a date but isn't",
};

function describeFinding(finding: ValidationFinding): string {
  const label = ISSUE_LABELS[finding.issue] ?? finding.issue;
  const columnPart = finding.column === "*" ? "" : ` — ${escapeHtml(finding.column)}`;
  const countPart = finding.count !== undefined ? ` (${finding.count})` : "";
  return `${label}${columnPart}${countPart}`;
}

function renderFindingsRows(job: Job): string {
  if (!job.validation_findings) {
    return "";
  }

  const findings: ValidationFindings = JSON.parse(job.validation_findings);
  const errorRows = findings.errors
    .map(
      (finding) =>
        `<tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 whitespace-nowrap w-px">Validation</th><td class="p-3 px-5 text-red-600 font-medium">${describeFinding(finding)}</td></tr>`,
    )
    .join("");
  const warningRows = findings.warnings
    .map(
      (finding) =>
        `<tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 whitespace-nowrap w-px">Validation</th><td class="p-3 px-5 text-amber-600 font-medium">${describeFinding(finding)}</td></tr>`,
    )
    .join("");

  return errorRows + warningRows;
}
```

Find the existing "Skipped rows" row inside `renderReportFragment`'s `html` template:
```typescript
                    <tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 whitespace-nowrap w-px">Skipped rows</th><td class="p-3 px-5 text-red-600 font-semibold">${skipped}</td></tr>
                </tbody>
            </table>
        </div>
```
Replace it with (inserts the findings rows right after "Skipped rows", still inside `<tbody>`):
```typescript
                    <tr class="hover:bg-gray-50 transition-colors"><th class="p-3 px-5 text-sm font-medium text-gray-500 whitespace-nowrap w-px">Skipped rows</th><td class="p-3 px-5 text-red-600 font-semibold">${skipped}</td></tr>
                    ${renderFindingsRows(job)}
                </tbody>
            </table>
        </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --env-file=.env --test test/report.test.ts`
Expected: PASS (17/17 tests: 14 before this task + 3 new). Specifically re-check the "shows no findings rows when validation_findings is null" test passes for the real reason (because `renderFindingsRows` returns `""` for a `null` value), not just because nothing was implemented.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS (48/48 tests: 45 after Task 1, +3 new in `report.test.ts`).

- [ ] **Step 6: Manual smoke test in a real browser**

Run: `npm run dev` in the background (loads `.env` via `--env-file=.env`). Then:
```bash
curl -s -X POST -F "file=@test/fixtures/dirty.csv" http://localhost:3000/upload
```
Note the returned `jobId`, then open `http://localhost:3000/report/<jobId>` in a browser. Confirm:
1. Status badge shows "DONE" (not failed).
2. Row count before/after shows 5 → 4 (the duplicate was removed).
3. A red "Validation" row appears reading "Duplicate rows found (2)".
4. Click "Download Cleaned CSV" — confirm the downloaded file has only 4 rows (the duplicate removed), proving clean still ran despite the validation finding.

Then upload `test/fixtures/valid.csv` (no issues) and confirm its report shows no "Validation" rows at all.

Stop the dev server after confirming (`pkill -f "tsx watch"` or equivalent).

- [ ] **Step 7: Run code-reviewer agent and code-review plugin, then commit**

Invoke the `code-reviewer` agent to confirm `report.ts` still only touches Postgres via `getJob`, and that `renderFindingsRows`'s `JSON.parse` is only ever called on a value this app itself wrote (never on raw user input) — confirm by tracing that `job.validation_findings` is only ever set by `completeJob`, never derived from request parameters. Then run the `code-review` plugin. Then commit with a short single-line message:

```bash
git add src/routes/report.ts test/report.test.ts
git commit -m "feat: render validation findings in the report summary table"
```

---

## Self-Review Notes

- Spec coverage: the non-blocking pipeline change, the new schema column, `completeJob`'s null-when-empty convention, the report's error/warning color distinction, the "omit rows entirely when null" rule, and the rewritten/added tests (including the stale blocking-test removal) are each covered by a task.
- Type consistency: `validationFindings: { errors, warnings }` is defined once in Task 1's `completeJob` signature and consumed identically in Task 2's `ValidationFindings` interface (same field names, same shapes) — no drift. `ValidationFinding`'s `count?: number` matches `ValidationWarning`'s existing optional `count` field from `validator.ts`.
- No placeholders: every step has runnable code, exact test assertions, or an exact command with expected output. The Step 9 test-count arithmetic in Task 1 is spelled out explicitly to avoid an off-by-one in the expected count.
- Verified directly against the real `validator.ts` output (not assumed) that `test/fixtures/invalid.csv` produces exactly one `duplicate_row` error (count 2, column `"*"`) and one `type_mismatch` warning (no count, column `signup_date`), and that `test/fixtures/empty-column.csv` produces exactly one `empty_column` error (count 3, column `notes`) — these exact shapes are used in Task 1's and Task 2's test assertions.
