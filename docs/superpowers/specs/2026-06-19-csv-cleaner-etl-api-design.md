# CSV Cleaner ETL API — Design

Date: 2026-06-19

## Purpose

Scaffold the `csv-cleaner` ETL API: upload a CSV, validate it, clean/dedupe it,
optionally enrich it with country data, persist job metadata to Postgres, and
serve an HTML report with charts.

## Stack

- Hono + TypeScript, Node.js runtime
- DuckDB (`duckdb` npm package) for all CSV reads/transforms (`read_csv_auto`, SQL)
- PostgreSQL for job metadata, via `pg`, connection string from `process.env.DATABASE_URL`
- Tailwind CSS + Chart.js via CDN in the server-rendered report HTML (no build step for the report)

## Config fixes (discovered during brainstorming)

The repo had inconsistent Postgres credentials across three files. `.env` is the
source of truth (`thuzar` / `thuzar_pass`); the other two are updated to match:

- `.env` — unchanged (`DATABASE_URL="postgresql://thuzar:thuzar_pass@localhost:5432/csv_cleaner"`)
- `docker-compose.yml` — `POSTGRES_USER`/`POSTGRES_PASSWORD` updated to `thuzar`/`thuzar_pass`
- `.mcp.json` — postgres MCP server connection string updated to `thuzar`/`thuzar_pass`

`init.sql` gets two additive columns (discussed and approved, since CLAUDE.md
flags it as "don't modify without discussion"):

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS enriched_columns TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skipped_rows INT DEFAULT 0;
```

## Folder structure

```
src/
  routes/
    upload.ts       thin handler: parse multipart, call dataCleaner.run(), return job id
    report.ts       thin handler: fetch job, render HTML report
  services/
    validator.ts    schema checks (nulls, type mismatches, dup count, row count)
    cleaner.ts       dedupe + normalize via DuckDB SQL
    enricher.ts      restcountries cache + join
  repositories/
    job.ts           all Postgres operations (only file that touches the DB)
  agents/
    dataCleaner.ts   orchestrates validate -> clean -> enrich -> save, in order
uploads/             raw CSV input (gitignored)
outputs/             cleaned CSV + nothing else persisted to disk from validate/clean steps
```

`validator.ts` and `cleaner.ts` are implementations of the blueprints in
`.claude/skills/data-validate/SKILL.md` and `.claude/agents/csv-data-normalizer.md`
respectively — those files are dev-time references only, never invoked at runtime
(per CLAUDE.md).

## Pipeline (orchestrated by `src/agents/dataCleaner.ts`)

Runs synchronously inside the `POST /upload` request — no background queue.

1. Save uploaded file to `uploads/<timestamp>_<filename>`. Insert job row,
   `status = 'pending'`.
2. **Validate** (`validator.ts`): load via `read_csv_auto`, check required-column
   nulls, type mismatches, duplicate-row count by detected primary key, total row
   count. Returns `{ valid, rowCount, errors, warnings }` in-memory — no file
   written. Proceeds regardless of `valid` value (errors get attached to job
   metadata, never block the pipeline). Update `status = 'validated'`.
3. **Clean** (`cleaner.ts`): DuckDB SQL — trim all string columns, normalize dates
   to ISO 8601, lowercase+trim email-like columns, dedupe (keep first occurrence
   by detected primary key, or full-row dedupe if no PK is obvious), empty
   string -> NULL. Writes `outputs/<file>_cleaned.csv`. Never touches
   `uploads/`. Update `status = 'cleaned'`.
4. **Enrich** (`enricher.ts`): on server startup, fetch
   `https://restcountries.com/v3.1/all` once into an in-memory `Map` keyed by
   lowercased country name and by `cca2`/`cca3`. If the startup fetch fails, log
   once and leave the cache empty — every job thereafter silently skips
   enrichment (this is the "optional" behavior CLAUDE.md requires, applied at
   cache level rather than per-job). Detect a country column by header name
   (case-insensitive match against `country`, `country_name`, `country_code`,
   `iso_code`, `iso2`, `iso3`). If found and cache is populated, join via DuckDB,
   track matched vs. skipped row counts and which output column(s) were added.
   If no column detected or cache empty, skip with no error. Update
   `status = 'enriched'` (skip this status transition if enrichment didn't run
   — falls through to `done` directly via the next step regardless).
5. **Save** (`job.ts`): final update — `status = 'done'`, `row_count_before`,
   `row_count_after`, `enriched_columns` (comma-joined list or null),
   `skipped_rows`. Any thrown error at any stage: catch in `dataCleaner.ts`,
   set `status = 'failed'` + `error_message`, halt pipeline, route returns
   HTTP 500 with the job id.

## Routes

### `POST /upload`

- Multipart form upload, single CSV file field
- Thin handler: write file to `uploads/`, call `dataCleaner.run(jobId, filePath)`, return `{ jobId, status }` as JSON
- No business logic in the route itself

### `GET /report/:id`

- Thin handler: `job.ts` repository fetches the job row
- Job not found -> `404` JSON error
- Job found, `status` not yet `done` (`pending`/`validated`/`cleaned`/`enriched`) -> render HTML page with a status banner instead of charts
- Job found, `status = 'failed'` -> render HTML page showing the error
- Job found, `status = 'done'` -> render full report:
  - Tailwind CDN layout/styling
  - Summary table: job status, filename, row_count_before, row_count_after, enriched_columns, skipped_rows
  - Chart.js bar chart #1: row count before vs. after
  - Chart.js bar chart #2: enrichment coverage % = `(row_count_after - skipped_rows) / row_count_after`

## Layering rules

- `src/routes/*` — parsing + delegation only, no DuckDB/Postgres calls
- `src/services/*` — DuckDB logic, pure business rules, no Postgres calls
- `src/repositories/job.ts` — only file that touches Postgres, via a `pg.Pool` built from `process.env.DATABASE_URL`
- `src/agents/dataCleaner.ts` — only place that sequences multiple services + the repository together

## Code style

- snake_case for DB fields/columns, camelCase for variables/functions, PascalCase for classes
- 4-space indent, no semicolons, trailing commas allowed
- No hardcoded secrets — everything from `process.env`

## Generated project files

- `tsconfig.json`
- `package.json` with `dev` (e.g. `tsx watch src/index.ts`) and `build` scripts
- `.gitignore` — `node_modules`, `uploads/`, `outputs/`, `.env`
- `.env.example` — `DATABASE_URL` placeholder only
- `README.md` — setup (docker compose up, npm install, npm run dev), curl examples for `/upload` and `/report/:id`

## Out of scope

- Background/async job processing (explicitly synchronous per discussion)
- Content-sniffing country detection (header-name heuristic only)
- Persisting validator/cleaner intermediate reports to disk (in-memory only, final summary lands in Postgres)
