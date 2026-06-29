# Non-Blocking Validation — Design

Date: 2026-06-29

## Purpose

Today, `runPipeline` treats `validateCsv`'s result as a gate: if `valid` is
`false` (e.g. a fully-empty column, or fully-duplicate rows), the job is
marked `failed` and clean/enrich never run. This means a CSV with one
duplicate row never gets cleaned at all, even though `cleaner.ts` already
knows how to dedupe it — the user just sees a rejection with no chance to see
what the cleaned result would have looked like.

Change validation to be purely informational: it always runs, its findings
are always recorded and shown to the user, but it never blocks clean/enrich
from running. The user sees both "here's what was wrong with your file" and
"here's the cleaned/enriched result" in the same report.

## Behavior change

### `dataCleaner.ts`

Remove the early-return block:
```typescript
if (!validation.valid) {
    const message = `validation failed: ${JSON.stringify(validation.errors)}`
    await failJob(job.id, message)
    return { jobId: job.id, status: "failed", errorMessage: message }
}
```
`runPipeline` always proceeds from `validateCsv` straight into `cleanCsv`,
regardless of `validation.valid`. `status: "failed"` is now reserved
exclusively for actual thrown errors (file I/O failures, DB errors, etc.) —
never for a validation finding. `validation.errors` and `validation.warnings`
are passed into `completeJob` alongside the existing fields.

### Schema (`init.sql`)

Additive column, consistent with the file's existing pattern:
```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS validation_findings TEXT;
```

### `job.ts`

- `Job` interface gains `validation_findings: string | null`.
- `completeJob`'s `fields` parameter gains:
  ```typescript
  validationFindings: {
      errors: { column: string; issue: string; count: number }[]
      warnings: { column: string; issue: string; count?: number }[]
  }
  ```
  Serialized to JSON and stored in `validation_findings`. If both `errors`
  and `warnings` are empty arrays, store `NULL` (matching the existing
  null-when-empty convention used for `enriched_columns`).

### `report.ts`

`renderReportFragment` parses `job.validation_findings` (when non-null) and
renders one additional `<tr>` per finding, inserted between the existing
"Skipped rows" row and the charts section. Errors render in red text
(matching the existing "Skipped rows" red-text convention); warnings render
in amber. Each row reads as `<issue label> — <column>` with the count shown
where it adds information, e.g.:
- "Duplicate rows found — 2" (column is `"*"`, so the column name is omitted
  from the label for this one issue type)
- "Empty column — notes"
- "High null ratio — notes (3 of 5 rows)"
- "Mostly numeric, 3 non-numeric values — score"
- "Looks like a date but isn't — signup_date"

If `job.validation_findings` is `null` (no findings at all), no extra rows
are rendered — the table looks exactly as it does today for a clean file.

## Out of scope

- No new `JobStatus` values — `done`/`failed` stay as-is, with `failed`'s
  meaning narrowed to "an actual exception occurred," never "validation
  found something."
- No row-level duplicate data captured or displayed — only counts and column
  names, consistent with every other finding type.
- No relational findings table — one JSON column, one render function.
- No changes to `validator.ts`'s, `cleaner.ts`'s, or `enricher.ts`'s internal
  detection/cleaning logic — this change is entirely about how the existing
  `ValidationResult` is *used* by the orchestrator and *displayed* by the
  report, not about what gets detected.

## Test impact

The existing `dataCleaner.test.ts` test "runPipeline marks job failed when
the CSV fails validation" (using `test/fixtures/empty-column.csv`) is no
longer accurate under this design and must be rewritten: that fixture should
now produce a `status: "done"` job with `validation_findings` populated
(an `empty_column` error for the `notes` column), not a `failed` job.

New test coverage needed:
- A CSV with a duplicate row produces a `done` job whose report shows a
  "Duplicate rows found" row, and whose output CSV has the duplicate removed
  (proving clean still ran and still works).
- A CSV with an empty column produces a `done` job whose report shows an
  "Empty column" row.
- A clean CSV (no findings) produces a report with no findings rows at all.
