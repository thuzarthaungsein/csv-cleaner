# Download Cleaned/Enriched CSV — Design

Date: 2026-06-26

## Purpose

Today, the cleaned/enriched CSV produced by the pipeline is written to `outputs/`
but never exposed via the API — there is no way for a user to retrieve it short
of accessing the filesystem directly. Add a download endpoint that serves the
final pipeline output for a completed job, plus a link to it from the existing
HTML report page.

## Problem with the current state

- `dataCleaner.ts`'s `runPipeline` computes `cleanResult.outputPath` and (if
  enrichment ran) `enrichResult.outputPath`, but never persists either to the
  `jobs` table.
- `completeJob` only stores row counts and enrichment metadata — no file path.
- Without a stored path, a download route would have to guess the filename from
  `file_name` + naming conventions, which is fragile if those conventions ever
  change.

## Schema change

`init.sql` gets one additive column, consistent with the existing pattern of
appending `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` after the original
`CREATE TABLE`:

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS output_path TEXT;
```

## `job.ts` changes

- `Job` interface gains `output_path: string | null`.
- `completeJob`'s `fields` parameter gains `outputPath: string`, written into
  the same `UPDATE jobs SET ...` statement as the existing fields.

## `dataCleaner.ts` changes

After the enrich step, compute the true final output path — whichever file is
the actual last-produced artifact for this job:

```typescript
const finalOutputPath = enrichResult.enriched
    ? enrichResult.outputPath
    : cleanResult.outputPath
```

Pass `outputPath: finalOutputPath` into the existing `completeJob` call. No
other pipeline logic changes — validate/clean/enrich ordering, status
transitions, and error handling stay exactly as they are today.

## New route: `GET /report/:id/download`

Added to `src/routes/report.ts` alongside the existing `GET /:id`, sharing the
same `getJob` repository call.

**Behavior:**
1. `getJob(id)` returns nothing → `404` JSON `{ error: "job not found" }`
   (matches the existing report route's not-found behavior).
2. `job.status !== "done"` → `400` JSON `{ error: "job not finished" }`. No
   redirect — a non-done job has no usable `output_path` yet (it's `NULL`
   until `completeJob` runs), so attempting to serve a file would either fail
   or serve nothing meaningful.
3. Otherwise: stream the file at `job.output_path` from disk.
   - `Content-Type: text/csv`
   - `Content-Disposition: attachment; filename="<base>_<suffix>.csv"` where
     `<base>` is `job.file_name` with its extension stripped, and `<suffix>`
     is `enriched` if `job.enriched_columns !== null`, else `cleaned` — this
     mirrors the actual suffix the services already produce, so the
     downloaded filename matches what a user would see if they inspected
     `outputs/` directly.
   - If the file at `job.output_path` doesn't exist on disk (e.g. manually
     deleted), return `404` JSON `{ error: "output file not found" }` rather
     than letting the stream fail opaquely.

**Out of scope:** no signed URLs, no expiry, no access control beyond what the
rest of the API already has (none) — this matches the existing report route's
security posture, just exposing a different representation of the same job.

## Report page change

`renderDone` in `report.ts` gets a small download link near the summary table
header, styled consistently with the existing Tailwind card aesthetic:

```html
<a href="/report/${job.id}/download" class="inline-flex items-center gap-2 ...">
    Download CSV
</a>
```

Exact Tailwind classes will follow the existing button/badge styling already
present in the file (rounded, subtle shadow, consistent color palette) —
finalized during implementation, not prescribed here.

## Testing

- `job.ts`: extend the existing `completeJob` test to assert `output_path` is
  persisted and returned by `getJob`.
- `dataCleaner.ts`: extend existing pipeline tests (or add one) asserting
  `output_path` is set to the cleaned path when enrichment didn't run, and to
  the enriched path when it did.
- `report.ts` download route:
  - Happy path: a `done` job with a real file on disk → `200`, correct
    `Content-Disposition` filename, correct CSV bytes in the response body.
  - Non-done job (e.g. `pending`) → `400`.
  - Nonexistent job id → `404`.
  - `done` job whose `output_path` file is missing from disk → `404`.

## Out of scope

- No changes to `validator.ts`, `cleaner.ts`, `enricher.ts`, or `upload.ts`.
- No new dependencies — file streaming uses Node's built-in `fs.createReadStream`
  wrapped for Hono's `c.body()`, consistent with the project's "no extra deps
  unless necessary" pattern so far.
- No retention/cleanup policy for `outputs/` files — unchanged from today.
