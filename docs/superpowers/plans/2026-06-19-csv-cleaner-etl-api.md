# CSV Cleaner ETL API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a working Hono + TypeScript ETL API that uploads a CSV, validates it, dedupes/normalizes it via DuckDB, optionally enriches it with restcountries.com data, persists job metadata to Postgres, and serves an HTML+Chart.js report.

**Architecture:** Layered: thin Hono routes → services (DuckDB business logic) → repository (Postgres-only) → agent (orchestrates the sequence). Pipeline runs synchronously inside the `POST /upload` request handler. No background job queue.

**Tech Stack:** Hono 4.x, TypeScript, Node.js (native `--test` runner via `tsx`), `duckdb-async` 1.4.x for CSV/SQL, `pg` 8.x for Postgres, Tailwind CSS + Chart.js via CDN in server-rendered HTML (no frontend build step).

## Global Constraints

- snake_case for DB fields/columns, camelCase for variables/functions, PascalCase for classes
- 4-space indent, no semicolons, trailing commas allowed
- No hardcoded secrets — everything from `process.env`
- Never overwrite source uploads in `uploads/` — write cleaned output to `outputs/` only
- Never mutate `init.sql` without flagging it (this plan's Task 1 extends it additively, already discussed/approved)
- `src/routes/*` — parsing + delegation only, no DuckDB/Postgres calls
- `src/services/*` — DuckDB logic only, no Postgres calls
- `src/repositories/job.ts` — only file that touches Postgres
- `src/agents/dataCleaner.ts` — only place that sequences services + repository together
- After each task: run the `code-reviewer` agent (ETL architecture check), then the `code-review` plugin (general quality check), then commit via `commit-commands` plugin — per CLAUDE.md's Workflow rule

---

## Task 1: Project scaffolding, config, and DB schema update

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Modify: `init.sql`
- Modify: `docker-compose.yml`
- Modify: `.mcp.json`
- Create: `src/index.ts`
- Test: `test/health.test.ts`

**Interfaces:**
- Produces: a running Hono server with `GET /health` returning `{ status: "ok" }`, used by every later task to confirm the server boots.

- [ ] **Step 1: Write `package.json`**

```json
{
    "name": "csv-cleaner",
    "version": "1.0.0",
    "description": "Hono + TypeScript ETL API: upload, validate, clean, enrich, report CSV data",
    "type": "module",
    "scripts": {
        "dev": "tsx watch src/index.ts",
        "build": "tsc -p tsconfig.json",
        "start": "node dist/index.js",
        "test": "tsx --test test/**/*.test.ts"
    },
    "dependencies": {
        "duckdb-async": "1.4.2",
        "hono": "4.12.26",
        "pg": "8.22.0"
    },
    "devDependencies": {
        "@types/node": "22.10.2",
        "@types/pg": "8.11.10",
        "tsx": "4.22.4",
        "typescript": "5.7.2"
    }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "NodeNext",
        "moduleResolution": "NodeNext",
        "outDir": "dist",
        "rootDir": "src",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "resolveJsonModule": true,
        "declaration": false,
        "sourceMap": true
    },
    "include": ["src/**/*.ts"],
    "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Write `.env.example`**

```
DATABASE_URL="postgresql://thuzar:thuzar_pass@localhost:5432/csv_cleaner"
PORT=3000
```

- [ ] **Step 4: Extend `init.sql` with enrichment columns**

Read the current file first, then append after the existing `CREATE INDEX` line:

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS enriched_columns TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skipped_rows INT DEFAULT 0;
```

- [ ] **Step 5: Fix Postgres credentials in `docker-compose.yml`**

Change:
```yaml
    environment:
      POSTGRES_USER: csv_user
      POSTGRES_PASSWORD: csv_pass
      POSTGRES_DB: csv_cleaner
```
to:
```yaml
    environment:
      POSTGRES_USER: thuzar
      POSTGRES_PASSWORD: thuzar_pass
      POSTGRES_DB: csv_cleaner
```

- [ ] **Step 6: Fix Postgres credentials in `.mcp.json`**

Change the postgres server's connection string from
`postgresql://csv_user:csv_pass@localhost:5432/csv_cleaner` to
`postgresql://thuzar:thuzar_pass@localhost:5432/csv_cleaner`.

- [ ] **Step 7: Write `src/index.ts`**

```typescript
import { serve } from "@hono/node-server"
import { Hono } from "hono"

const app = new Hono()

app.get("/health", (c) => {
    return c.json({ status: "ok" })
})

const port = Number(process.env.PORT) || 3000

serve({ fetch: app.fetch, port }, (info) => {
    console.log(`csv-cleaner listening on http://localhost:${info.port}`)
})
```

This needs `@hono/node-server` — add it to `package.json` dependencies:

```json
        "@hono/node-server": "1.14.4",
```

(Re-run Step 1 mentally: add this line into the `dependencies` block alongside `duckdb-async`, `hono`, `pg`.)

- [ ] **Step 8: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors. (`npm view @hono/node-server version` confirms `1.14.4` is current at plan-writing time; if install resolves a different version that's fine.)

- [ ] **Step 9: Write the failing test**

`test/health.test.ts`:

```typescript
import { test } from "node:test"
import assert from "node:assert/strict"
import { Hono } from "hono"

function buildHealthApp() {
    const app = new Hono()
    app.get("/health", (c) => c.json({ status: "ok" }))
    return app
}

test("GET /health returns status ok", async () => {
    const app = buildHealthApp()
    const res = await app.request("/health")
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.deepEqual(body, { status: "ok" })
})
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npm test`
Expected: PASS (1 test). This test is self-contained (rebuilds the route inline) so it exercises Hono's request/response contract without needing the real server running.

- [ ] **Step 11: Verify the real server boots**

Run: `npm run dev` in the background, then `curl -s http://localhost:3000/health`
Expected: `{"status":"ok"}`. Stop the dev server after confirming.

- [ ] **Step 12: Run code-reviewer agent and code-review plugin, then commit**

Invoke the `code-reviewer` agent to check this task's changes against the layering rules (trivial at this stage — no services/routes yet). Then run the `code-review` plugin for general quality. Then commit via `commit-commands`:

```bash
git add package.json package-lock.json tsconfig.json .env.example init.sql docker-compose.yml .mcp.json src/index.ts test/health.test.ts
git commit -m "feat: scaffold Hono server, tsconfig, and DB schema updates"
```

---

## Task 2: `validator.ts` — schema validation service

**Files:**
- Create: `src/services/validator.ts`
- Test: `test/validator.test.ts`
- Create: `test/fixtures/valid.csv`
- Create: `test/fixtures/invalid.csv`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure DuckDB + filesystem).
- Produces:
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
  `dataCleaner.ts` (Task 5) calls `validateCsv(filePath)`.

- [ ] **Step 1: Create fixture CSVs**

`test/fixtures/valid.csv`:
```csv
id,name,email,signup_date
1,Alice,alice@example.com,2024-01-15
2,Bob,bob@example.com,2024-02-20
3,Carol,carol@example.com,2024-03-10
```

`test/fixtures/invalid.csv`:
```csv
id,name,email,signup_date
1,Alice,alice@example.com,2024-01-15
2,,bob@example.com,2024-02-20
2,Bob,bob@example.com,2024-02-20
3,Carol,not-an-email,bad-date
```

(Row 2 has a null `name`; id `2` is duplicated; the last row has a malformed date — `bad-date` is fine in DuckDB as a VARCHAR column since `read_csv_auto` will type the whole `signup_date` column as VARCHAR once it sees a non-date value, which is exactly the type-mismatch condition we want to detect against the `valid.csv` baseline expectation of a DATE-typed column.)

- [ ] **Step 2: Write the failing test**

`test/validator.test.ts`:

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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/services/validator.js'"

- [ ] **Step 4: Implement `src/services/validator.ts`**

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

const REQUIRED_COLUMNS = ["id", "name", "email"]

export async function validateCsv(filePath: string): Promise<ValidationResult> {
    const db = await Database.create(":memory:")
    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []

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

    for (const column of REQUIRED_COLUMNS) {
        if (!columnNames.includes(column)) {
            continue
        }
        const [{ nullCount }] = await db.all(
            `SELECT COUNT(*)::INT AS "nullCount" FROM read_csv_auto('${escapedPath}') WHERE "${column}" IS NULL OR "${column}" = ''`,
        )
        if (nullCount > 0) {
            errors.push({ column, issue: "null_value", count: nullCount })
        }
    }

    if (columnNames.includes("id")) {
        const [{ dupCount }] = await db.all(`
            SELECT COUNT(*)::INT AS "dupCount" FROM (
                SELECT "id" FROM read_csv_auto('${escapedPath}')
                GROUP BY "id"
                HAVING COUNT(*) > 1
            ) AS dups
        `)
        if (dupCount > 0) {
            errors.push({ column: "id", issue: "duplicate_row", count: dupCount })
        }
    }

    for (const [column, type] of columnTypes) {
        if (column.toLowerCase().includes("date") && type === "VARCHAR") {
            warnings.push({ column, issue: "type_mismatch" })
        }
    }

    await db.close()

    return {
        valid: errors.length === 0,
        rowCount,
        errors,
        warnings,
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 tests total — health + 2 validator tests)

- [ ] **Step 6: Run code-reviewer agent and code-review plugin, then commit**

Invoke `code-reviewer` to confirm `validator.ts` has no Postgres calls and stays within `src/services/`. Then run `code-review` plugin. Then:

```bash
git add src/services/validator.ts test/validator.test.ts test/fixtures/valid.csv test/fixtures/invalid.csv
git commit -m "feat: add CSV schema validator service"
```

---

## Task 3: `cleaner.ts` — dedupe and normalize service

**Files:**
- Create: `src/services/cleaner.ts`
- Test: `test/cleaner.test.ts`
- Create: `test/fixtures/dirty.csv`

**Interfaces:**
- Consumes: nothing from earlier tasks directly (pure DuckDB + filesystem), but is always called after `validateCsv` in the pipeline (Task 5).
- Produces:
  ```typescript
  export interface CleanResult {
      outputPath: string
      rowCountBefore: number
      rowCountAfter: number
  }

  export async function cleanCsv(filePath: string, outputDir: string): Promise<CleanResult>
  ```
  `dataCleaner.ts` (Task 5) calls `cleanCsv(uploadPath, "outputs")` and uses `result.outputPath` as the input to `enricher.ts`.

- [ ] **Step 1: Create fixture CSV**

`test/fixtures/dirty.csv`:
```csv
id,name,email,signup_date
1,  Alice  ,ALICE@Example.com,2024-01-15
2,Bob,bob@example.com,2024-02-20
2,Bob,bob@example.com,2024-02-20
3,Carol,carol@example.com,2024-03-10
4,,dave@example.com,2024-04-01
```

(Row 1 has whitespace and uppercase email; rows with `id=2` are exact duplicates; row with `id=4` has an empty `name` that should become NULL.)

- [ ] **Step 2: Write the failing test**

`test/cleaner.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/services/cleaner.js'"

- [ ] **Step 4: Implement `src/services/cleaner.ts`**

```typescript
import { Database } from "duckdb-async"
import { basename, extname, join } from "node:path"

export interface CleanResult {
    outputPath: string
    rowCountBefore: number
    rowCountAfter: number
}

export async function cleanCsv(filePath: string, outputDir: string): Promise<CleanResult> {
    const db = await Database.create(":memory:")
    const escapedInput = filePath.replace(/'/g, "''")

    const [{ rowCountBefore }] = await db.all(
        `SELECT COUNT(*)::INT AS "rowCountBefore" FROM read_csv_auto('${escapedInput}')`,
    )

    const columns = await db.all(
        `DESCRIBE SELECT * FROM read_csv_auto('${escapedInput}')`,
    )
    const columnNames = columns.map((c: Record<string, unknown>) => String(c.column_name))

    const selectParts = columnNames.map((column) => {
        const lower = column.toLowerCase()
        if (lower.includes("email")) {
            return `NULLIF(LOWER(TRIM("${column}")), '') AS "${column}"`
        }
        if (lower.includes("date")) {
            return `TRY_CAST(TRIM("${column}") AS DATE) AS "${column}"`
        }
        return `NULLIF(TRIM("${column}"), '') AS "${column}"`
    })

    const dedupeKey = columnNames.includes("id") ? "id" : columnNames[0]

    const baseName = basename(filePath, extname(filePath))
    const outputPath = join(outputDir, `${baseName}_cleaned.csv`)
    const escapedOutput = outputPath.replace(/'/g, "''")

    await db.exec(`
        COPY (
            SELECT DISTINCT ON ("${dedupeKey}") ${selectParts.join(", ")}
            FROM read_csv_auto('${escapedInput}')
            ORDER BY "${dedupeKey}"
        ) TO '${escapedOutput}' (HEADER, DELIMITER ',')
    `)

    const [{ rowCountAfter }] = await db.all(
        `SELECT COUNT(*)::INT AS "rowCountAfter" FROM read_csv_auto('${escapedOutput}')`,
    )

    await db.close()

    return { outputPath, rowCountBefore, rowCountAfter }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (4 tests total)

- [ ] **Step 6: Run code-reviewer agent and code-review plugin, then commit**

Invoke `code-reviewer` to confirm `cleaner.ts` never writes to `uploads/` and only writes to the passed-in `outputDir`. Then run `code-review` plugin. Then:

```bash
git add src/services/cleaner.ts test/cleaner.test.ts test/fixtures/dirty.csv
git commit -m "feat: add CSV dedupe/normalize cleaner service"
```

---

## Task 4: `enricher.ts` — restcountries enrichment service

**Files:**
- Create: `src/services/enricher.ts`
- Test: `test/enricher.test.ts`
- Create: `test/fixtures/with_country.csv`
- Create: `test/fixtures/no_country.csv`

**Interfaces:**
- Consumes: nothing from earlier tasks directly; called by `dataCleaner.ts` (Task 5) after `cleanCsv`.
- Produces:
  ```typescript
  export interface CountryRecord {
      name: string
      cca2: string
      cca3: string
      region: string
  }

  export interface EnrichResult {
      enriched: boolean
      outputPath: string
      enrichedColumns: string[]
      matchedRows: number
      skippedRows: number
  }

  export function buildCountryCache(countries: CountryRecord[]): Map<string, CountryRecord>
  export async function fetchCountryCache(): Promise<Map<string, CountryRecord>>
  export async function enrichCsv(filePath: string, outputDir: string, cache: Map<string, CountryRecord>): Promise<EnrichResult>
  ```
  `dataCleaner.ts` (Task 5) holds one `Map<string, CountryRecord>` built at startup via `fetchCountryCache()`, and passes it into `enrichCsv` per job. `buildCountryCache` is exported separately so tests and the startup path share identical cache-construction logic without a network call in tests.

- [ ] **Step 1: Create fixture CSVs**

`test/fixtures/with_country.csv`:
```csv
id,name,country
1,Alice,United States
2,Bob,FR
3,Carol,Wakanda
```

(Row 3's "Wakanda" is fictional — exercises the skipped-row path.)

`test/fixtures/no_country.csv`:
```csv
id,name,email
1,Alice,alice@example.com
2,Bob,bob@example.com
```

- [ ] **Step 2: Write the failing test**

`test/enricher.test.ts`:

```typescript
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildCountryCache, enrichCsv } from "../src/services/enricher.js"
import type { CountryRecord } from "../src/services/enricher.js"

const FIXTURE_COUNTRIES: CountryRecord[] = [
    { name: "United States", cca2: "US", cca3: "USA", region: "Americas" },
    { name: "France", cca2: "FR", cca3: "FRA", region: "Europe" },
]

test("enrichCsv joins on country name or ISO code and tracks skipped rows", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "csv-cleaner-test-"))
    try {
        const cache = buildCountryCache(FIXTURE_COUNTRIES)
        const result = await enrichCsv("test/fixtures/with_country.csv", outputDir, cache)

        assert.equal(result.enriched, true)
        assert.equal(result.matchedRows, 2)
        assert.equal(result.skippedRows, 1)
        assert.deepEqual(result.enrichedColumns, ["region", "cca3"])

        const contents = await readFile(result.outputPath, "utf-8")
        assert.ok(contents.includes("Americas"))
        assert.ok(contents.includes("Europe"))
    } finally {
        await rm(outputDir, { recursive: true, force: true })
    }
})

test("enrichCsv skips gracefully when no country column is present", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "csv-cleaner-test-"))
    try {
        const cache = buildCountryCache(FIXTURE_COUNTRIES)
        const result = await enrichCsv("test/fixtures/no_country.csv", outputDir, cache)

        assert.equal(result.enriched, false)
        assert.equal(result.matchedRows, 0)
        assert.equal(result.skippedRows, 0)
        assert.deepEqual(result.enrichedColumns, [])
    } finally {
        await rm(outputDir, { recursive: true, force: true })
    }
})

test("enrichCsv skips gracefully when the cache is empty", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "csv-cleaner-test-"))
    try {
        const emptyCache = buildCountryCache([])
        const result = await enrichCsv("test/fixtures/with_country.csv", outputDir, emptyCache)

        assert.equal(result.enriched, false)
        assert.equal(result.matchedRows, 0)
    } finally {
        await rm(outputDir, { recursive: true, force: true })
    }
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/services/enricher.js'"

- [ ] **Step 4: Implement `src/services/enricher.ts`**

```typescript
import { Database } from "duckdb-async"
import { writeFile, unlink } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"

export interface CountryRecord {
    name: string
    cca2: string
    cca3: string
    region: string
}

export interface EnrichResult {
    enriched: boolean
    outputPath: string
    enrichedColumns: string[]
    matchedRows: number
    skippedRows: number
}

const COUNTRY_COLUMN_NAMES = ["country", "country_name", "country_code", "iso_code", "iso2", "iso3"]

export function buildCountryCache(countries: CountryRecord[]): Map<string, CountryRecord> {
    const cache = new Map<string, CountryRecord>()
    for (const country of countries) {
        cache.set(country.name.toLowerCase(), country)
        cache.set(country.cca2.toLowerCase(), country)
        cache.set(country.cca3.toLowerCase(), country)
    }
    return cache
}

export async function fetchCountryCache(): Promise<Map<string, CountryRecord>> {
    try {
        const response = await fetch("https://restcountries.com/v3.1/all?fields=name,cca2,cca3,region")
        if (!response.ok) {
            console.warn(`restcountries fetch failed with status ${response.status}; enrichment disabled`)
            return new Map()
        }
        const data = (await response.json()) as Array<{
            name: { common: string }
            cca2: string
            cca3: string
            region: string
        }>
        const countries: CountryRecord[] = data.map((entry) => ({
            name: entry.name.common,
            cca2: entry.cca2,
            cca3: entry.cca3,
            region: entry.region,
        }))
        return buildCountryCache(countries)
    } catch (error) {
        console.warn("restcountries fetch threw; enrichment disabled:", error)
        return new Map()
    }
}

function findCountryColumn(columnNames: string[]): string | undefined {
    return columnNames.find((column) => COUNTRY_COLUMN_NAMES.includes(column.toLowerCase()))
}

export async function enrichCsv(
    filePath: string,
    outputDir: string,
    cache: Map<string, CountryRecord>,
): Promise<EnrichResult> {
    const baseName = basename(filePath, extname(filePath))
    const outputPath = join(outputDir, `${baseName}_enriched.csv`)

    if (cache.size === 0) {
        return { enriched: false, outputPath: filePath, enrichedColumns: [], matchedRows: 0, skippedRows: 0 }
    }

    const db = await Database.create(":memory:")
    const escapedInput = filePath.replace(/'/g, "''")

    const columns = await db.all(`DESCRIBE SELECT * FROM read_csv_auto('${escapedInput}')`)
    const columnNames = columns.map((c: Record<string, unknown>) => String(c.column_name))
    const countryColumn = findCountryColumn(columnNames)

    if (!countryColumn) {
        await db.close()
        return { enriched: false, outputPath: filePath, enrichedColumns: [], matchedRows: 0, skippedRows: 0 }
    }

    const rows = await db.all(`SELECT * FROM read_csv_auto('${escapedInput}')`)
    const lookupRows = rows.map((row: Record<string, unknown>) => {
        const key = String(row[countryColumn] ?? "").toLowerCase()
        const match = cache.get(key)
        return {
            [countryColumn]: row[countryColumn],
            region: match?.region ?? null,
            cca3: match?.cca3 ?? null,
        }
    })

    const matchedRows = lookupRows.filter((row) => row.region !== null).length
    const skippedRows = lookupRows.length - matchedRows

    const lookupPath = join(tmpdir(), `country-lookup-${randomUUID()}.json`)
    await writeFile(lookupPath, JSON.stringify(lookupRows))
    const escapedLookup = lookupPath.replace(/'/g, "''")
    const escapedOutput = outputPath.replace(/'/g, "''")

    await db.exec(`
        COPY (
            SELECT src.*, lookup.region, lookup.cca3
            FROM read_csv_auto('${escapedInput}') AS src
            POSITIONAL JOIN read_json_auto('${escapedLookup}') AS lookup
        ) TO '${escapedOutput}' (HEADER, DELIMITER ',')
    `)

    await db.close()
    await unlink(lookupPath)

    return {
        enriched: true,
        outputPath,
        enrichedColumns: ["region", "cca3"],
        matchedRows,
        skippedRows,
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (7 tests total). The implementation writes row-level lookup results (country column + matched `region`/`cca3`) to a temp JSON file, then uses DuckDB's `POSITIONAL JOIN` to stitch them back onto the original CSV by row order — this avoids row-by-row prepared-statement inserts, which is a much shakier API surface in `duckdb-async`. `POSITIONAL JOIN` requires both sides to have the same row count and order, which holds here since `lookupRows` is derived 1:1 from `rows` in the same order. If `POSITIONAL JOIN` isn't supported by the installed DuckDB version, fall back to adding a `ROW_NUMBER()` column to both the source read and the lookup JSON and joining on that explicitly instead.

- [ ] **Step 6: Run code-reviewer agent and code-review plugin, then commit**

Invoke `code-reviewer` to confirm enrichment failures never throw (always return a graceful `enriched: false` result) and the service makes no Postgres calls. Then run `code-review` plugin. Then:

```bash
git add src/services/enricher.ts test/enricher.test.ts test/fixtures/with_country.csv test/fixtures/no_country.csv
git commit -m "feat: add restcountries enrichment service"
```

---

## Task 5: `job.ts` repository — Postgres operations

**Files:**
- Create: `src/repositories/job.ts`
- Test: `test/job.test.ts`

**Interfaces:**
- Consumes: `process.env.DATABASE_URL`.
- Produces:
  ```typescript
  export type JobStatus = "pending" | "validated" | "cleaned" | "enriched" | "done" | "failed"

  export interface Job {
      id: number
      file_name: string
      status: JobStatus
      row_count_before: number | null
      row_count_after: number | null
      enriched_api: string | null
      enriched_columns: string | null
      skipped_rows: number | null
      error_message: string | null
      created_at: Date
      updated_at: Date
  }

  export async function createJob(fileName: string): Promise<Job>
  export async function updateJobStatus(id: number, status: JobStatus): Promise<void>
  export async function completeJob(id: number, fields: {
      rowCountBefore: number
      rowCountAfter: number
      enrichedApi: string | null
      enrichedColumns: string[]
      skippedRows: number
  }): Promise<void>
  export async function failJob(id: number, errorMessage: string): Promise<void>
  export async function getJob(id: number): Promise<Job | null>
  ```
  `dataCleaner.ts` (Task 6) and `report.ts` (Task 8) both import from this file. This is the only file permitted to import `pg`.

- [ ] **Step 1: Write the failing test**

This test requires a real Postgres connection (the repository's whole job is to talk to Postgres — mocking it would test nothing real). It assumes `docker compose up -d` has been run per Task 1's credential fix.

`test/job.test.ts`:

```typescript
import { test } from "node:test"
import assert from "node:assert/strict"
import { createJob, updateJobStatus, completeJob, failJob, getJob } from "../src/repositories/job.js"

test("createJob inserts a pending job and getJob retrieves it", async () => {
    const job = await createJob("sample.csv")
    assert.equal(job.file_name, "sample.csv")
    assert.equal(job.status, "pending")

    const fetched = await getJob(job.id)
    assert.ok(fetched)
    assert.equal(fetched?.id, job.id)
})

test("updateJobStatus advances status", async () => {
    const job = await createJob("sample2.csv")
    await updateJobStatus(job.id, "validated")
    const fetched = await getJob(job.id)
    assert.equal(fetched?.status, "validated")
})

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

test("failJob sets status failed and error_message", async () => {
    const job = await createJob("sample4.csv")
    await failJob(job.id, "boom")
    const fetched = await getJob(job.id)
    assert.equal(fetched?.status, "failed")
    assert.equal(fetched?.error_message, "boom")
})

test("getJob returns null for missing id", async () => {
    const fetched = await getJob(999999)
    assert.equal(fetched, null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/repositories/job.js'"

- [ ] **Step 3: Implement `src/repositories/job.ts`**

```typescript
import { Pool } from "pg"

export type JobStatus = "pending" | "validated" | "cleaned" | "enriched" | "done" | "failed"

export interface Job {
    id: number
    file_name: string
    status: JobStatus
    row_count_before: number | null
    row_count_after: number | null
    enriched_api: string | null
    enriched_columns: string | null
    skipped_rows: number | null
    error_message: string | null
    created_at: Date
    updated_at: Date
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function createJob(fileName: string): Promise<Job> {
    const result = await pool.query<Job>(
        `INSERT INTO jobs (file_name, status) VALUES ($1, 'pending') RETURNING *`,
        [fileName],
    )
    return result.rows[0]
}

export async function updateJobStatus(id: number, status: JobStatus): Promise<void> {
    await pool.query(
        `UPDATE jobs SET status = $1, updated_at = NOW() WHERE id = $2`,
        [status, id],
    )
}

export async function completeJob(
    id: number,
    fields: {
        rowCountBefore: number
        rowCountAfter: number
        enrichedApi: string | null
        enrichedColumns: string[]
        skippedRows: number
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
            updated_at = NOW()
        WHERE id = $6`,
        [
            fields.rowCountBefore,
            fields.rowCountAfter,
            fields.enrichedApi,
            fields.enrichedColumns.length > 0 ? fields.enrichedColumns.join(",") : null,
            fields.skippedRows,
            id,
        ],
    )
}

export async function failJob(id: number, errorMessage: string): Promise<void> {
    await pool.query(
        `UPDATE jobs SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [errorMessage, id],
    )
}

export async function getJob(id: number): Promise<Job | null> {
    const result = await pool.query<Job>(`SELECT * FROM jobs WHERE id = $1`, [id])
    return result.rows[0] ?? null
}
```

- [ ] **Step 4: Start Postgres and run the test**

Run: `docker compose up -d` then wait for it to be healthy, then `npm test`
Expected: PASS (12 tests total). If connection fails, verify `.env`'s `DATABASE_URL` matches the Task 1 credential fix and that `docker compose up -d` succeeded with `docker compose ps`.

Note: `test/job.test.ts` needs `process.env.DATABASE_URL` loaded. Add a `test/setup.ts`:

```typescript
import { config } from "node:process"
```

Actually Node doesn't auto-load `.env` — add `--env-file=.env` to the test script in `package.json` Step 1 of Task 1, updating it now:

```json
        "test": "tsx --env-file=.env --test test/**/*.test.ts"
```

Re-run: `npm test`
Expected: PASS (12 tests total)

- [ ] **Step 5: Run code-reviewer agent and code-review plugin, then commit**

Invoke `code-reviewer` to confirm `job.ts` is the only file importing `pg` so far. Then run `code-review` plugin. Then:

```bash
git add src/repositories/job.ts test/job.test.ts package.json
git commit -m "feat: add Postgres job repository"
```

---

## Task 6: `dataCleaner.ts` — pipeline orchestration agent

**Files:**
- Create: `src/agents/dataCleaner.ts`
- Test: `test/dataCleaner.test.ts`

**Interfaces:**
- Consumes: `validateCsv` (Task 2), `cleanCsv` (Task 3), `enrichCsv` + `CountryRecord` + cache type (Task 4), `createJob`/`updateJobStatus`/`completeJob`/`failJob` (Task 5).
- Produces:
  ```typescript
  export interface PipelineResult {
      jobId: number
      status: "done" | "failed"
      errorMessage?: string
  }

  export async function runPipeline(
      filePath: string,
      countryCache: Map<string, CountryRecord>,
  ): Promise<PipelineResult>
  ```
  `upload.ts` route (Task 7) calls `runPipeline(uploadedFilePath, countryCache)`.

- [ ] **Step 1: Write the failing test**

`test/dataCleaner.test.ts`:

```typescript
import { test } from "node:test"
import assert from "node:assert/strict"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runPipeline } from "../src/agents/dataCleaner.js"
import { buildCountryCache } from "../src/services/enricher.js"
import { getJob } from "../src/repositories/job.js"

test("runPipeline runs full pipeline end to end and marks job done", async () => {
    const uploadDir = await mkdtemp(join(tmpdir(), "csv-cleaner-upload-"))
    const uploadPath = join(uploadDir, "valid.csv")
    await copyFile("test/fixtures/valid.csv", uploadPath)

    try {
        const cache = buildCountryCache([])
        const result = await runPipeline(uploadPath, cache)

        assert.equal(result.status, "done")
        const job = await getJob(result.jobId)
        assert.equal(job?.status, "done")
        assert.equal(job?.row_count_before, 3)
    } finally {
        await rm(uploadDir, { recursive: true, force: true })
    }
})

test("runPipeline marks job failed when the input file does not exist", async () => {
    const result = await runPipeline("uploads/does-not-exist.csv", buildCountryCache([]))
    assert.equal(result.status, "failed")
    const job = await getJob(result.jobId)
    assert.equal(job?.status, "failed")
    assert.ok(job?.error_message)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/agents/dataCleaner.js'"

- [ ] **Step 3: Implement `src/agents/dataCleaner.ts`**

```typescript
import { basename } from "node:path"
import { validateCsv } from "../services/validator.js"
import { cleanCsv } from "../services/cleaner.js"
import { enrichCsv } from "../services/enricher.js"
import type { CountryRecord } from "../services/enricher.js"
import { createJob, updateJobStatus, completeJob, failJob } from "../repositories/job.js"

export interface PipelineResult {
    jobId: number
    status: "done" | "failed"
    errorMessage?: string
}

const OUTPUT_DIR = "outputs"

export async function runPipeline(
    filePath: string,
    countryCache: Map<string, CountryRecord>,
): Promise<PipelineResult> {
    const job = await createJob(basename(filePath))

    try {
        const validation = await validateCsv(filePath)
        await updateJobStatus(job.id, "validated")

        const cleanResult = await cleanCsv(filePath, OUTPUT_DIR)
        await updateJobStatus(job.id, "cleaned")

        const enrichResult = await enrichCsv(cleanResult.outputPath, OUTPUT_DIR, countryCache)
        if (enrichResult.enriched) {
            await updateJobStatus(job.id, "enriched")
        }

        await completeJob(job.id, {
            rowCountBefore: validation.rowCount,
            rowCountAfter: cleanResult.rowCountAfter,
            enrichedApi: enrichResult.enriched ? "restcountries.com/v3.1" : null,
            enrichedColumns: enrichResult.enrichedColumns,
            skippedRows: enrichResult.skippedRows,
        })

        return { jobId: job.id, status: "done" }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await failJob(job.id, message)
        return { jobId: job.id, status: "failed", errorMessage: message }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (14 tests total)

- [ ] **Step 5: Run code-reviewer agent and code-review plugin, then commit**

Invoke `code-reviewer` to confirm `dataCleaner.ts` is the only file sequencing multiple services + the repository, and that pipeline order (validate → clean → enrich → save) is never skipped or reordered. Then run `code-review` plugin. Then:

```bash
git add src/agents/dataCleaner.ts test/dataCleaner.test.ts
git commit -m "feat: add pipeline orchestration agent"
```

---

## Task 7: `POST /upload` route

**Files:**
- Create: `src/routes/upload.ts`
- Modify: `src/index.ts`
- Test: `test/upload.test.ts`

**Interfaces:**
- Consumes: `runPipeline` (Task 6), a shared `countryCache: Map<string, CountryRecord>` built once at startup via `fetchCountryCache()` (Task 4).
- Produces: a Hono route mounted at `POST /upload` that the report route (Task 8) doesn't depend on directly, but which is the only way jobs get created end-to-end via HTTP.

- [ ] **Step 1: Write the failing test**

`test/upload.test.ts`:

```typescript
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile, rm } from "node:fs/promises"
import { buildUploadRoute } from "../src/routes/upload.js"
import { Hono } from "hono"
import { buildCountryCache } from "../src/services/enricher.js"

test("POST /upload accepts a multipart CSV and returns a job id", async () => {
    const app = new Hono()
    app.route("/upload", buildUploadRoute(buildCountryCache([])))

    const csvContents = await readFile("test/fixtures/valid.csv")
    const formData = new FormData()
    formData.append("file", new Blob([csvContents], { type: "text/csv" }), "valid.csv")

    const res = await app.request("/upload", {
        method: "POST",
        body: formData,
    })
    const body = await res.json()

    assert.equal(res.status, 200)
    assert.equal(typeof body.jobId, "number")
    assert.equal(body.status, "done")

    await rm(`uploads/${body.fileName}`, { force: true }).catch(() => {})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/routes/upload.js'"

- [ ] **Step 3: Implement `src/routes/upload.ts`**

```typescript
import { Hono } from "hono"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { runPipeline } from "../agents/dataCleaner.js"
import type { CountryRecord } from "../services/enricher.js"

const UPLOAD_DIR = "uploads"

export function buildUploadRoute(countryCache: Map<string, CountryRecord>) {
    const route = new Hono()

    route.post("/", async (c) => {
        const body = await c.req.parseBody()
        const file = body.file

        if (!(file instanceof File)) {
            return c.json({ error: "file field is required" }, 400)
        }

        await mkdir(UPLOAD_DIR, { recursive: true })
        const fileName = `${Date.now()}_${file.name}`
        const filePath = join(UPLOAD_DIR, fileName)
        const buffer = Buffer.from(await file.arrayBuffer())
        await writeFile(filePath, buffer)

        const result = await runPipeline(filePath, countryCache)

        return c.json({ jobId: result.jobId, status: result.status, fileName })
    })

    return route
}
```

- [ ] **Step 4: Wire the route into `src/index.ts`**

Replace the contents of `src/index.ts`:

```typescript
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { buildUploadRoute } from "./routes/upload.js"
import { fetchCountryCache } from "./services/enricher.js"

const app = new Hono()

app.get("/health", (c) => {
    return c.json({ status: "ok" })
})

const countryCache = await fetchCountryCache()
app.route("/upload", buildUploadRoute(countryCache))

const port = Number(process.env.PORT) || 3000

serve({ fetch: app.fetch, port }, (info) => {
    console.log(`csv-cleaner listening on http://localhost:${info.port}`)
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (15 tests total)

- [ ] **Step 6: Manual smoke test against the real server**

Run: `npm run dev` in the background, then:
```bash
curl -s -X POST -F "file=@test/fixtures/valid.csv" http://localhost:3000/upload
```
Expected: JSON with `jobId`, `status: "done"`, `fileName`. Stop the dev server after confirming.

- [ ] **Step 7: Run code-reviewer agent and code-review plugin, then commit**

Invoke `code-reviewer` to confirm `upload.ts` contains no business logic — only multipart parsing, file write, and delegation to `runPipeline`. Then run `code-review` plugin. Then:

```bash
git add src/routes/upload.ts src/index.ts test/upload.test.ts
git commit -m "feat: add POST /upload route"
```

---

## Task 8: `GET /report/:id` route with Tailwind + Chart.js HTML

**Files:**
- Create: `src/routes/report.ts`
- Modify: `src/index.ts`
- Test: `test/report.test.ts`

**Interfaces:**
- Consumes: `getJob` (Task 5).
- Produces: a Hono route mounted at `GET /report/:id`. Terminal — no later task depends on this one.

- [ ] **Step 1: Write the failing test**

`test/report.test.ts`:

```typescript
import { test } from "node:test"
import assert from "node:assert/strict"
import { Hono } from "hono"
import { buildReportRoute } from "../src/routes/report.js"
import { createJob, completeJob } from "../src/repositories/job.js"

test("GET /report/:id returns 404 for missing job", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const res = await app.request("/report/999999")
    assert.equal(res.status, 404)
})

test("GET /report/:id renders status banner for a pending job", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const job = await createJob("pending_job.csv")

    const res = await app.request(`/report/${job.id}`)
    const html = await res.text()
    assert.equal(res.status, 200)
    assert.ok(html.includes("pending"))
    assert.ok(!html.includes("Chart("))
})

test("GET /report/:id renders charts and summary table for a done job", async () => {
    const app = new Hono()
    app.route("/report", buildReportRoute())

    const job = await createJob("done_job.csv")
    await completeJob(job.id, {
        rowCountBefore: 10,
        rowCountAfter: 8,
        enrichedApi: "restcountries.com/v3.1",
        enrichedColumns: ["region", "cca3"],
        skippedRows: 1,
    })

    const res = await app.request(`/report/${job.id}`)
    const html = await res.text()
    assert.equal(res.status, 200)
    assert.ok(html.includes("done_job.csv"))
    assert.ok(html.includes("Chart("))
    assert.ok(html.includes("tailwindcss"))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../src/routes/report.js'"

- [ ] **Step 3: Implement `src/routes/report.ts`**

```typescript
import { Hono } from "hono"
import { getJob } from "../repositories/job.js"
import type { Job } from "../repositories/job.js"

function renderInProgress(job: Job): string {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Job ${job.id} - ${job.status}</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 p-8">
    <div class="max-w-xl mx-auto bg-white rounded-lg shadow p-6">
        <h1 class="text-xl font-bold mb-2">Job ${job.id}: ${job.file_name}</h1>
        <p class="text-gray-600">Status: <span class="font-mono">${job.status}</span></p>
        ${job.status === "failed" ? `<p class="text-red-600 mt-4">${job.error_message ?? ""}</p>` : ""}
    </div>
</body>
</html>`
}

function renderDone(job: Job): string {
    const rowBefore = job.row_count_before ?? 0
    const rowAfter = job.row_count_after ?? 0
    const skipped = job.skipped_rows ?? 0
    const coverage = rowAfter > 0 ? Math.round(((rowAfter - skipped) / rowAfter) * 100) : 0
    const enrichedColumns = job.enriched_columns ?? "none"

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Report - Job ${job.id}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-gray-50 p-8">
    <div class="max-w-3xl mx-auto space-y-6">
        <h1 class="text-2xl font-bold">Report: ${job.file_name}</h1>

        <table class="w-full bg-white rounded-lg shadow text-left">
            <tbody>
                <tr class="border-b"><th class="p-3">Status</th><td class="p-3">${job.status}</td></tr>
                <tr class="border-b"><th class="p-3">Filename</th><td class="p-3">${job.file_name}</td></tr>
                <tr class="border-b"><th class="p-3">Row count before</th><td class="p-3">${rowBefore}</td></tr>
                <tr class="border-b"><th class="p-3">Row count after</th><td class="p-3">${rowAfter}</td></tr>
                <tr class="border-b"><th class="p-3">Enriched columns</th><td class="p-3">${enrichedColumns}</td></tr>
                <tr><th class="p-3">Skipped rows</th><td class="p-3">${skipped}</td></tr>
            </tbody>
        </table>

        <div class="bg-white rounded-lg shadow p-4">
            <canvas id="rowCountChart"></canvas>
        </div>
        <div class="bg-white rounded-lg shadow p-4">
            <canvas id="coverageChart"></canvas>
        </div>
    </div>

    <script>
        new Chart(document.getElementById("rowCountChart"), {
            type: "bar",
            data: {
                labels: ["Before", "After"],
                datasets: [{ label: "Row count", data: [${rowBefore}, ${rowAfter}], backgroundColor: ["#94a3b8", "#3b82f6"] }],
            },
        })
        new Chart(document.getElementById("coverageChart"), {
            type: "bar",
            data: {
                labels: ["Enrichment coverage %"],
                datasets: [{ label: "Coverage", data: [${coverage}], backgroundColor: ["#22c55e"] }],
            },
            options: { scales: { y: { max: 100 } } },
        })
    </script>
</body>
</html>`
}

export function buildReportRoute() {
    const route = new Hono()

    route.get("/:id", async (c) => {
        const id = Number(c.req.param("id"))
        const job = await getJob(id)

        if (!job) {
            return c.json({ error: "job not found" }, 404)
        }

        const html = job.status === "done" || job.status === "failed"
            ? job.status === "done" ? renderDone(job) : renderInProgress(job)
            : renderInProgress(job)

        return c.html(html)
    })

    return route
}
```

- [ ] **Step 4: Wire the route into `src/index.ts`**

Add to `src/index.ts` after the `/upload` route registration:

```typescript
import { buildReportRoute } from "./routes/report.js"
```

and:

```typescript
app.route("/report", buildReportRoute())
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (18 tests total)

- [ ] **Step 6: Manual smoke test against the real server**

Run: `npm run dev` in the background, then:
```bash
JOB_ID=$(curl -s -X POST -F "file=@test/fixtures/valid.csv" http://localhost:3000/upload | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).jobId))")
curl -s http://localhost:3000/report/$JOB_ID | head -20
```
Expected: HTML containing `tailwindcss`, `Chart.js`, and the job's filename. Stop the dev server after confirming.

- [ ] **Step 7: Run code-reviewer agent and code-review plugin, then commit**

Invoke `code-reviewer` to confirm `report.ts` does no direct DB access (only via `getJob`) and contains no pipeline logic. Then run `code-review` plugin. Then:

```bash
git add src/routes/report.ts src/index.ts test/report.test.ts
git commit -m "feat: add GET /report/:id route with Chart.js report"
```

---

## Task 9: README and final polish

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: nothing — documentation only.
- Produces: nothing consumed by other tasks — this is the terminal documentation task.

- [ ] **Step 1: Write `README.md`**

```markdown
# csv-cleaner

Hono + TypeScript ETL API. Uploads CSV → validates → cleans → enriches → serves chart report.

## Setup

1. Copy `.env.example` to `.env` and adjust if needed:
   \`\`\`bash
   cp .env.example .env
   \`\`\`
2. Start Postgres:
   \`\`\`bash
   docker compose up -d
   \`\`\`
3. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`
4. Run in dev mode:
   \`\`\`bash
   npm run dev
   \`\`\`

## Usage

### Upload a CSV

\`\`\`bash
curl -X POST -F "file=@path/to/your.csv" http://localhost:3000/upload
\`\`\`

Response:
\`\`\`json
{ "jobId": 1, "status": "done", "fileName": "1718999999999_your.csv" }
\`\`\`

### View the report

\`\`\`bash
curl http://localhost:3000/report/1
\`\`\`

Or open `http://localhost:3000/report/1` in a browser for the full Tailwind + Chart.js report.

## Pipeline

1. **Validate** — schema checks (nulls, type mismatches, duplicate rows, row count)
2. **Clean** — DuckDB SQL: trim, normalize dates to ISO 8601, lowercase emails, dedupe, empty string → NULL
3. **Enrich** — optional join against restcountries.com data if a country column is detected; gracefully skipped otherwise
4. **Save** — job metadata persisted to Postgres `jobs` table
5. **Report** — `GET /report/:id` renders an HTML report with summary table and Chart.js bar charts

## Testing

\`\`\`bash
npm test
\`\`\`

Requires Postgres running (`docker compose up -d`) since the repository tests hit a real database.
```

- [ ] **Step 2: Run the full test suite one final time**

Run: `npm test`
Expected: PASS (18 tests total)

- [ ] **Step 3: Run code-reviewer agent and code-review plugin, then commit**

Invoke `code-reviewer` for a final full-project ETL architecture pass. Then run `code-review` plugin for a final general quality pass. Then:

```bash
git add README.md
git commit -m "docs: add README with setup and usage instructions"
```

---

## Self-Review Notes

- Spec coverage: all 6 pipeline stages, both routes, all generated config files (`tsconfig.json`, `package.json`, `.gitignore` [already committed pre-plan], `.env.example`, `README.md`), and the `init.sql`/`docker-compose.yml`/`.mcp.json` credential fixes are each covered by a task.
- Type consistency checked: `CountryRecord`, `EnrichResult`, `ValidationResult`, `CleanResult`, `Job`, `JobStatus`, and `PipelineResult` are defined once (Tasks 2–6) and reused with identical shapes in every later task that imports them.
- No placeholders: every step has runnable code or an exact command with expected output.
