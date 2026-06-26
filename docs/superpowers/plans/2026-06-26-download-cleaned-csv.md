# Download Cleaned/Enriched CSV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user download the final pipeline output (cleaned or cleaned+enriched CSV) for a completed job via a new `GET /report/:id/download` route, with a link to it from the existing HTML report page.

**Architecture:** Persist the final output file path on the `jobs` row (set by `dataCleaner.ts` after the pipeline finishes), then add a new Hono route that reads the job, checks its status, and streams the file from disk with an appropriate filename and content type.

**Tech Stack:** Hono 4.x (`c.body()` with a Web `ReadableStream`), Node's `fs.createReadStream`/`stream.Readable.toWeb`, PostgreSQL via `pg`, `node:test`.

## Global Constraints

- snake_case for DB fields/columns, camelCase for variables/functions, PascalCase for classes
- `src/repositories/job.ts` is the only file permitted to import `pg` — this plan does not change that
- `src/routes/*` — thin handlers, only touch Postgres via `getJob`, no direct DB queries
- Never overwrite or mutate files in `uploads/` — this plan only reads from `outputs/`, never writes there
- Match each file's existing code style as found at the start of this plan: `src/repositories/job.ts`, `src/agents/dataCleaner.ts`, and `test/*.ts` use no semicolons; `src/routes/report.ts` currently uses semicolons (a prior local edit) — preserve each file's existing convention rather than normalizing it
- A job that is not `status === "done"` has no usable `output_path` (it is `NULL` until `completeJob` runs) — the download route must not attempt to stream for any other status

---

## Task 1: Persist `output_path` on the `jobs` table and through `completeJob`

**Files:**
- Modify: `init.sql`
- Modify: `src/repositories/job.ts`
- Modify: `src/agents/dataCleaner.ts`
- Modify: `test/job.test.ts`
- Modify: `test/dataCleaner.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces:
  ```typescript
  // job.ts
  export interface Job {
      id: number
      file_name: string
      status: JobStatus
      row_count_before: number | null
      row_count_after: number | null
      enriched_api: string | null
      enriched_columns: string | null
      skipped_rows: number | null
      output_path: string | null   // NEW
      error_message: string | null
      created_at: Date
      updated_at: Date
  }

  export async function completeJob(
      id: number,
      fields: {
          rowCountBefore: number
          rowCountAfter: number
          enrichedApi: string | null
          enrichedColumns: string[]
          skippedRows: number
          outputPath: string        // NEW, required
      },
  ): Promise<void>
  ```
  Task 2 (the download route) consumes `job.output_path` from `getJob`'s return value.

- [ ] **Step 1: Add the schema column to `init.sql`**

Append this line after the existing `ALTER TABLE` lines at the end of the file:
```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS output_path TEXT;
```

- [ ] **Step 2: Apply the column to the running database**

Run: `docker compose ps` to confirm Postgres is up (`docker compose up -d` if not), then:
```bash
docker exec csv_cleaner_db psql -U thuzar -d csv_cleaner -c "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS output_path TEXT;"
```
Expected output: `ALTER TABLE`

Verify: `docker exec csv_cleaner_db psql -U thuzar -d csv_cleaner -c "\d jobs"` shows an `output_path` column of type `text`.

- [ ] **Step 3: Write the failing test for `job.ts`**

In `test/job.test.ts`, replace the existing `completeJob` test:
```typescript
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
```
with this version (adds `outputPath` to the call and asserts it round-trips):
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

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx tsx --env-file=.env --test test/job.test.ts`
Expected: FAIL — TypeScript error or runtime assertion failure, since `completeJob`'s `fields` type doesn't yet accept `outputPath` and the column doesn't yet round-trip (note: Step 2 already added the column to the DB, but `completeJob`'s SQL doesn't write to it yet, so `fetched?.output_path` will be `null`, failing the new assertion).

- [ ] **Step 5: Update `src/repositories/job.ts`**

Add `output_path: string | null` to the `Job` interface, right after `skipped_rows`:
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
    error_message: string | null
    created_at: Date
    updated_at: Date
}
```

Update `completeJob` to accept and persist `outputPath`:
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
    },
): Promise<void> {
    await pool.query(
        `UPDATE jobs SET
            status = 'done',
            row_count_before = $1,
            row_count_after = $2,
            enriched_api = $3,
            enriched_columns = $4,
            skipped_rows = $5,
            output_path = $6,
            updated_at = NOW()
        WHERE id = $7`,
        [
            fields.rowCountBefore,
            fields.rowCountAfter,
            fields.enrichedApi,
            fields.enrichedColumns.length > 0 ? fields.enrichedColumns.join(",") : null,
            fields.skippedRows,
            fields.outputPath,
            id,
        ],
    )
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx tsx --env-file=.env --test test/job.test.ts`
Expected: PASS (5/5 tests)

- [ ] **Step 7: Update `src/agents/dataCleaner.ts` to compute and pass the final output path**

Find the existing `completeJob` call:
```typescript
        await completeJob(job.id, {
            rowCountBefore: validation.rowCount,
            rowCountAfter: cleanResult.rowCountAfter,
            enrichedApi: enrichResult.enriched ? "mledoze/countries" : null,
            enrichedColumns: enrichResult.enrichedColumns,
            skippedRows: enrichResult.skippedRows,
        })
```
Replace it with (adds the `finalOutputPath` computation right before the call, and the new field inside it):
```typescript
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
        })
```

- [ ] **Step 8: Add a failing test to `test/dataCleaner.test.ts` covering both output-path cases**

Add this test after the existing "runPipeline enriches rows with a populated country cache" test:
```typescript
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
```

- [ ] **Step 9: Run the test to verify it fails**

Run: `npx tsx --env-file=.env --test test/dataCleaner.test.ts`
Expected: FAIL — `job?.output_path` is `undefined`/`null` since `dataCleaner.ts` doesn't pass `outputPath` yet (this step's test is written before Step 7's fix is in place if you're following strict TDD; if you already applied Step 7 before writing this test, skip ahead — but verify by temporarily commenting out the `outputPath: finalOutputPath` line and confirming the test fails, then restore it).

- [ ] **Step 10: Run the test to verify it passes**

Run: `npx tsx --env-file=.env --test test/dataCleaner.test.ts`
Expected: PASS (6/6 tests)

- [ ] **Step 11: Run the full test suite**

Run: `npm test`
Expected: PASS, all tests green (31 total: 29 previous + 2 new).

- [ ] **Step 12: Run code-reviewer agent and code-review plugin, then commit**

Invoke the `code-reviewer` agent to confirm `job.ts` remains the only file importing `pg`, and that `dataCleaner.ts` still makes no direct DB/DuckDB calls of its own (only via the services/repository it already imports). Then run the `code-review` plugin. Then commit with a short single-line message:

```bash
git add init.sql src/repositories/job.ts src/agents/dataCleaner.ts test/job.test.ts test/dataCleaner.test.ts
git commit -m "feat: persist final output path on job completion"
```

---

## Task 2: Add `GET /report/:id/download` route

**Files:**
- Modify: `src/routes/report.ts`
- Modify: `test/report.test.ts`

**Interfaces:**
- Consumes: `getJob` (unchanged signature) returning `Job` with the new `output_path: string | null` field from Task 1.
- Produces: a new route mounted at `GET /:id/download` inside `buildReportRoute()`. No other file depends on this route's internals — it's a leaf endpoint.

- [ ] **Step 1: Write the failing tests**

Add these tests to `test/report.test.ts`, after the existing tests. The file currently imports only `test`, `assert`, `Hono`, `buildReportRoute`, `createJob`, `completeJob` — add this new import line for the filesystem helpers these tests need:
```typescript
import { mkdir, writeFile, rm } from "node:fs/promises";
```

```typescript
test("GET /report/:id/download returns 404 for missing job", async () => {
    const app = new Hono();
    app.route("/report", buildReportRoute());

    const res = await app.request("/report/999999/download");
    assert.equal(res.status, 404);
});

test("GET /report/:id/download returns 400 for a job that is not done", async () => {
    const app = new Hono();
    app.route("/report", buildReportRoute());

    const job = await createJob("pending_download.csv");

    const res = await app.request(`/report/${job.id}/download`);
    assert.equal(res.status, 400);
});

test("GET /report/:id/download streams the output file with correct headers", async () => {
    const app = new Hono();
    app.route("/report", buildReportRoute());

    await mkdir("outputs", { recursive: true });
    const outputPath = "outputs/download_test_enriched.csv";
    await writeFile(outputPath, "id,name\n1,Alice\n");

    const job = await createJob("download_test.csv");
    await completeJob(job.id, {
        rowCountBefore: 1,
        rowCountAfter: 1,
        enrichedApi: "mledoze/countries",
        enrichedColumns: ["region", "cca3"],
        skippedRows: 0,
        outputPath,
    });

    try {
        const res = await app.request(`/report/${job.id}/download`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "text/csv");
        assert.ok(res.headers.get("content-disposition")?.includes("download_test_enriched.csv"));
        const body = await res.text();
        assert.equal(body, "id,name\n1,Alice\n");
    } finally {
        await rm(outputPath, { force: true });
    }
});

test("GET /report/:id/download returns 404 when the output file is missing from disk", async () => {
    const app = new Hono();
    app.route("/report", buildReportRoute());

    const job = await createJob("missing_output.csv");
    await completeJob(job.id, {
        rowCountBefore: 1,
        rowCountAfter: 1,
        enrichedApi: null,
        enrichedColumns: [],
        skippedRows: 0,
        outputPath: "outputs/this_file_does_not_exist_cleaned.csv",
    });

    const res = await app.request(`/report/${job.id}/download`);
    assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --env-file=.env --test test/report.test.ts`
Expected: FAIL — `/download` route doesn't exist yet, so all 4 new tests fail (likely with 404s from Hono's default not-found handling for the pending/streaming/missing-file tests too, since no route matches `/:id/download` — verify the failures are because the route is absent, not for some other reason).

- [ ] **Step 3: Implement the download route in `src/routes/report.ts`**

Add these imports at the top of the file (this file currently uses semicolons — match that):
```typescript
import { createReadStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { basename, extname } from "node:path";
```

Add this function after `escapeHtml` and before `renderInProgress`:
```typescript
function buildDownloadFileName(job: Job): string {
  const base = basename(job.file_name, extname(job.file_name));
  const suffix = job.enriched_columns !== null ? "enriched" : "cleaned";
  return `${base}_${suffix}.csv`;
}
```

Update `buildReportRoute()` to add the new route. Replace:
```typescript
export function buildReportRoute() {
  const route = new Hono();

  route.get("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const job = await getJob(id);

    if (!job) {
      return c.json({ error: "job not found" }, 404);
    }

    const html =
      job.status === "done" ? renderDone(job) : renderInProgress(job);

    return c.html(html);
  });

  return route;
}
```
with:
```typescript
export function buildReportRoute() {
  const route = new Hono();

  route.get("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const job = await getJob(id);

    if (!job) {
      return c.json({ error: "job not found" }, 404);
    }

    const html =
      job.status === "done" ? renderDone(job) : renderInProgress(job);

    return c.html(html);
  });

  route.get("/:id/download", async (c) => {
    const id = Number(c.req.param("id"));
    const job = await getJob(id);

    if (!job) {
      return c.json({ error: "job not found" }, 404);
    }

    if (job.status !== "done" || !job.output_path) {
      return c.json({ error: "job not finished" }, 400);
    }

    if (!existsSync(job.output_path)) {
      return c.json({ error: "output file not found" }, 404);
    }

    const fileName = buildDownloadFileName(job);
    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", `attachment; filename="${fileName}"`);

    const nodeStream = createReadStream(job.output_path);
    return c.body(Readable.toWeb(nodeStream) as ReadableStream);
  });

  return route;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --env-file=.env --test test/report.test.ts`
Expected: PASS (9/9 tests: 5 previous + 4 new)

- [ ] **Step 5: Run the full test suite**

Run: `npm test` (ensure `docker compose ps` shows Postgres running first)
Expected: PASS, all tests green (35 total: 31 from Task 1 + 4 new).

- [ ] **Step 6: Manual smoke test against the real server**

Run: `npm run dev` in the background (it loads `.env` via `--env-file=.env` automatically), then:
```bash
JOB_ID=$(curl -s -X POST -F "file=@test/fixtures/valid.csv" http://localhost:3000/upload | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).jobId))")
curl -s -D - -o /tmp/downloaded.csv http://localhost:3000/report/$JOB_ID/download | head -20
cat /tmp/downloaded.csv
```
Expected: response headers show `content-type: text/csv` and a `content-disposition: attachment; filename="..."` header, and `/tmp/downloaded.csv` contains the cleaned CSV content (trimmed/normalized rows from `valid.csv`). Stop the dev server after confirming (`pkill -f "tsx watch"` or equivalent).

- [ ] **Step 7: Run code-reviewer agent and code-review plugin, then commit**

Invoke `code-reviewer` to confirm `report.ts` only touches Postgres via `getJob` (no direct `pg` import), and that the download route doesn't leak filesystem paths outside `job.output_path` (no path traversal surface, since the path comes from the trusted DB column, not user input). Then run `code-review` plugin. Then commit with a short single-line message:

```bash
git add src/routes/report.ts test/report.test.ts
git commit -m "feat: add GET /report/:id/download route"
```

---

## Task 3: Add a download link to the HTML report page

**Files:**
- Modify: `src/routes/report.ts`
- Modify: `test/report.test.ts`

**Interfaces:**
- Consumes: nothing new — this task only adds a link inside the existing `renderDone` function to the route built in Task 2.
- Produces: nothing consumed by other tasks — this is the final task.

- [ ] **Step 1: Write the failing test**

Add this test to `test/report.test.ts`, after the existing "renders charts and summary table for a done job" test:
```typescript
test("GET /report/:id includes a download link for a done job", async () => {
    const app = new Hono();
    app.route("/report", buildReportRoute());

    const job = await createJob("downloadable_job.csv");
    await completeJob(job.id, {
        rowCountBefore: 10,
        rowCountAfter: 8,
        enrichedApi: "mledoze/countries",
        enrichedColumns: ["region", "cca3"],
        skippedRows: 1,
        outputPath: "outputs/downloadable_job_enriched.csv",
    });

    const res = await app.request(`/report/${job.id}`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.ok(html.includes(`/report/${job.id}/download`));
    assert.ok(html.includes("Download CSV"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --env-file=.env --test test/report.test.ts`
Expected: FAIL — `html.includes(\`/report/${job.id}/download\`)` is false, since `renderDone` doesn't emit a download link yet.

- [ ] **Step 3: Add the download link to `renderDone` in `src/routes/report.ts`**

Find the header section of `renderDone`'s returned template:
```typescript
        <div class="flex items-center justify-between">
            <h1 class="text-2xl font-bold text-gray-900">Report: <span class="font-mono text-gray-600">${fileName}</span></h1>
            <span class="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusBadgeClass}">${status}</span>
        </div>
```
Replace it with (adds a download link next to the status badge):
```typescript
        <div class="flex items-center justify-between">
            <h1 class="text-2xl font-bold text-gray-900">Report: <span class="font-mono text-gray-600">${fileName}</span></h1>
            <div class="flex items-center gap-3">
                <a href="/report/${job.id}/download" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold shadow hover:bg-blue-700 transition-colors">Download CSV</a>
                <span class="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusBadgeClass}">${status}</span>
            </div>
        </div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --env-file=.env --test test/report.test.ts`
Expected: PASS (10/10 tests)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS, all tests green (36 total).

- [ ] **Step 6: Manual visual verification**

Run: `npm run dev` in the background, upload a CSV, open `http://localhost:3000/report/<jobId>` in a browser. Confirm a "Download CSV" button appears next to the status badge, and clicking it downloads the file. Stop the dev server after confirming.

- [ ] **Step 7: Run code-reviewer agent and code-review plugin, then commit**

Invoke `code-reviewer` for a final pass confirming the report page change is presentation-only (no new business logic, no new DB calls beyond the existing `getJob`). Then run `code-review` plugin. Then commit with a short single-line message:

```bash
git add src/routes/report.ts test/report.test.ts
git commit -m "feat: add download link to report page"
```

---

## Self-Review Notes

- Spec coverage: schema column, `completeJob`/`dataCleaner.ts` persistence of the final output path, the new download route (404/400/200/404-missing-file cases), the filename-suffix logic matching what the services actually produce, and the report-page link are each covered by a task with a concrete test.
- Type consistency: `Job.output_path` and `completeJob`'s `outputPath` field names are introduced once in Task 1 and consumed identically (via `getJob`'s return value) in Tasks 2 and 3 — no drift.
- No placeholders: every step has runnable code, exact test assertions, or an exact command with expected output.
- Note for the implementer: `src/routes/report.ts` currently uses semicolons (diverging from this project's no-semicolon convention used everywhere else) due to a prior manual edit outside this plan's scope — all code added to this file in this plan preserves that file's existing semicolon style rather than mixing conventions within one file.
