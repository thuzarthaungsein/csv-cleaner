# csv-cleaner

Hono + TypeScript ETL API. Uploads CSV → validates → cleans → enriches → serves chart report.

## Pipeline

```
POST /upload
    │
    ▼
validator.ts ── schema checks: nulls, type mismatches, duplicate rows, row count
    │
    │  invalid? ──► fail fast, job marked "failed", clean/enrich are skipped
    ▼
cleaner.ts ── DuckDB SQL: trim, normalize dates to ISO 8601, lowercase emails, dedupe, empty string → NULL
    │
    ▼
enricher.ts ── optional join against country reference data if a country column is detected
    │
    ▼
job.ts ── job metadata, status, and row counts saved to Postgres
    │
    ▼
GET /report/:id ── HTML report with summary table and Chart.js bar charts
```

Validation gates the pipeline: a CSV that fails validation is marked `failed` immediately and never reaches the clean or enrich stages.

## Setup

1. Copy `.env.example` to `.env` and adjust if needed:
   ```bash
   cp .env.example .env
   ```
2. Start Postgres:
   ```bash
   docker compose up -d
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run in dev mode:
   ```bash
   npm run dev
   ```

`npm run dev` and `npm test` both load environment variables from `.env` via `--env-file=.env`, so step 1 is required before either command will pick up your config.

## Environment variables

Copy `.env.example` to `.env` and fill in your own values — see the Setup section above.

| Variable            | Description                             |
| ------------------- | --------------------------------------- |
| `DATABASE_URL`      | Postgres connection string used by `pg` |
| `PORT`              | Port the Hono server listens on         |
| `POSTGRES_USER`     | Postgres DB username                    |
| `POSTGRES_PASSWORD` | Postgres DB user password               |

## Quick start: try it yourself

This walks through a real upload end-to-end, from a sample CSV to a rendered report.

### 1. CSV structure

There's no fixed schema — any CSV works. Validation reacts to data quality, not column names:

- A column that's **completely empty** (every value null/blank) is reported as an error.
- A column where **more than half** its values are null/blank is reported as a warning.
- **Fully duplicate rows** (every column identical) are reported as an error.
- A text column where **90% or more** of values look numeric (but not all) is reported as a warning — usually means a few bad rows broke what should be a numeric column.
- A text column with **"date" in its name** is reported as a warning if it didn't parse as a date.

Duplicate detection compares the full row — two rows are only flagged as duplicates if every column matches, not just an id-like column.

### 2. Sample CSV with country enrichment

Save this as `sample.csv` — note there's nothing special about its columns, but it includes a `country` column, which triggers enrichment:

```csv
id,name,email,country
1,Alice,alice@example.com,United States
2,Bob,bob@example.com,FR
3,Carol,carol@example.com,Wakanda
```

The enricher detects the `country` column (it matches on header names `country`, `country_name`, `country_code`, `iso_code`, `iso2`, or `iso3` — case-insensitive) and looks each value up by name or ISO code (`cca2`/`cca3`) against the cached country dataset. `United States` and `FR` will match and get enriched with region/ISO data; `Wakanda` isn't a real country, so that row is counted as **skipped** — this is intentional in the sample, to show what a partial-match job looks like.

A working copy of this fixture already exists in the repo at `test/fixtures/valid_with_country.csv`, so you can use that directly instead of retyping it.

### 3. Upload it and follow the job

```bash
curl -X POST -F "file=@test/fixtures/valid_with_country.csv" http://localhost:3000/upload
```

```json
{
  "jobId": 1,
  "status": "done",
  "fileName": "1718999999999_valid_with_country.csv"
}
```

Then open the report in a browser (or curl it):

```bash
curl http://localhost:3000/report/1
# or open http://localhost:3000/report/1
```

The summary table will show `enriched_columns: region,cca3` and `skipped_rows: 1` (the Wakanda row), and the coverage chart will reflect 2 enriched out of 3 rows.

### 4. Try a CSV with no country column

`test/fixtures/valid.csv` has no country-like column, so enrichment is skipped gracefully — the job still completes, the report just shows "Not enriched" instead of a coverage percentage:

```bash
curl -X POST -F "file=@test/fixtures/valid.csv" http://localhost:3000/upload
```

### 5. Try a CSV that fails validation

`test/fixtures/empty-column.csv` has a column (`notes`) that's completely empty, which fails validation — the job is marked `failed` before clean/enrich ever run:

```bash
curl -X POST -F "file=@test/fixtures/empty-column.csv" http://localhost:3000/upload
```

```json
{
  "jobId": 4,
  "status": "failed",
  "fileName": "...",
  "errorMessage": "validation failed: [...]"
}
```

All of the fixtures referenced above already exist in `test/fixtures/` — no need to create your own to start exploring.

## Usage

### Health check

```bash
curl http://localhost:3000/health
```

Response:

```json
{ "status": "ok" }
```

### Upload a CSV

```bash
curl -X POST -F "file=@path/to/your.csv" http://localhost:3000/upload
```

Success response (HTTP 200):

```json
{ "jobId": 1, "status": "done", "fileName": "1718999999999_your.csv" }
```

If validation or any later pipeline stage fails, the endpoint returns **HTTP 500** with an `errorMessage` field instead:

```json
{
  "jobId": 2,
  "status": "failed",
  "fileName": "1718999999999_bad.csv",
  "errorMessage": "validation failed: [...]"
}
```

### View the report

```bash
curl http://localhost:3000/report/1
```

Or open `http://localhost:3000/report/1` in a browser for the full Tailwind + Chart.js report.

## Enrichment notes

Country enrichment fetches reference data from `raw.githubusercontent.com/mledoze/countries` (a static JSON dataset). The API originally targeted `restcountries.com`, but that service is currently deprecated/broken, so the enricher was switched to the mledoze/countries dataset instead. Enrichment is entirely optional — if no country column is detected in the CSV, or if the country data fetch fails at startup, enrichment is skipped gracefully and the rest of the pipeline proceeds unaffected.

## Testing

```bash
npm test
```

Requires Postgres running (`docker compose up -d`) since the repository tests hit a real database. `npm test` loads `.env` automatically via `--env-file=.env`.
