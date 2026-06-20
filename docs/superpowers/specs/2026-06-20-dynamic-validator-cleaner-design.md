# Dynamic Validator/Cleaner — Design

Date: 2026-06-20

## Purpose

`validator.ts` currently hardcodes `id`, `name`, `email` as required columns, which
breaks for any real-world CSV that doesn't happen to use that exact schema. Replace
the hardcoded checks with fully dynamic, schema-agnostic detection driven by the
CSV's actual header and DuckDB-inferred column types. Bring `cleaner.ts`'s dedupe
logic and email-detection heuristic in line with the same dynamic approach.

## `validator.ts` changes

Remove `REQUIRED_COLUMNS = ["id", "name", "email"]` entirely. No column name is
special-cased. All checks operate on whatever columns are actually present.

### Empty-column check (error)

For every column (regardless of type), if 100% of its values are NULL or empty
string, push:
```
{ column, issue: "empty_column", count: rowCount }
```

### High-null-ratio check (warning)

For every column NOT already flagged as `empty_column`, if more than 50% of its
values are NULL or empty string, push:
```
{ column, issue: "high_null_ratio", count: nullCount }
```

These two checks are mutually exclusive per column — a 100%-null column gets only
the `empty_column` error, never also the `high_null_ratio` warning.

### Duplicate-row check (error)

Full-row comparison: group by every column, flag any group with `COUNT(*) > 1`.
There is no single dedupe key. Reported as:
```
{ column: "*", issue: "duplicate_row", count: <number of fully-duplicate rows> }
```
`"*"` is a sentinel meaning "applies to the whole row," since this check is no
longer scoped to one column.

### Numeric-mismatch check (warning)

For every column DuckDB infers as VARCHAR, sample its non-null values and check
what fraction match a numeric pattern (`^-?\d+(\.\d+)?$`). If 90% or more match,
push:
```
{ column, issue: "numeric_mismatch", count: <non-numeric value count> }
```
This catches "this column is mostly numbers but a few rows broke numeric
inference," which DuckDB's single-type-per-column inference otherwise hides.

### Date-mismatch check (warning) — unchanged

The existing heuristic stays as an independent rule: a VARCHAR column whose name
contains "date" (case-insensitive) gets:
```
{ column, issue: "type_mismatch" }
```
This coexists with the numeric-mismatch check — a column could in principle
trigger both if it matched both heuristics; that's acceptable since they detect
different things.

### Output contract — unchanged

```typescript
interface ValidationResult {
    valid: boolean
    rowCount: number
    errors: ValidationError[]
    warnings: ValidationWarning[]
}
```
`valid` is still `errors.length === 0`.

## `cleaner.ts` changes

### Dedupe key → full-row distinct

Replace `DISTINCT ON (dedupeKey) ... ORDER BY dedupeKey` with a full-row
`DISTINCT` (or equivalent `GROUP BY` over every column), matching the validator's
duplicate-row definition. Remove the `dedupeKey`/`columnNames[0]` fallback logic
entirely — there is no single key column anymore.

### Email detection → exact name match

Replace the current `lower.includes("email")` substring match with an exact
(case-insensitive) match against `["email", "e_mail", "email_address"]`. This
prevents false positives like a column named `emails_sent` being incorrectly
lowercased as if it were an email field.

### Unchanged

String trimming and date-cast logic stay as-is — both are already dynamic via
the `columnTypes` map built from `DESCRIBE`.

## Fixture and test updates

- `test/validator.test.ts`: rewrite assertions for the new issue shapes
  (`empty_column`, `high_null_ratio`, `numeric_mismatch`, full-row `duplicate_row`
  with `column: "*"`).
- `test/fixtures/missing-column.csv`: no longer exercises a meaningful failure
  under the new rules (a missing `email` column isn't special anymore). Rename/
  repurpose into a fixture with one fully-empty column to exercise
  `empty_column`, e.g. `test/fixtures/empty-column.csv`.
- `test/cleaner.test.ts`: update dedupe assertions to full-row comparison instead
  of single-key `DISTINCT ON`.
- `test/dataCleaner.test.ts` / `test/upload.test.ts`: any test relying on "missing
  email column fails validation" must switch to a fixture that actually fails
  under the new rules (e.g. the renamed empty-column fixture).

## README updates

- Remove the "Required CSV columns" table — no columns are required by name
  anymore.
- Rewrite the Quick Start walkthrough to show that any CSV structure works, and
  that validation now reacts to data quality (empty columns, high null ratios,
  duplicate rows, numeric/date mismatches) rather than a fixed schema.
- Add a note that duplicate detection compares full rows, not a single key
  column.
- **Environment variables section: do not list any example values, even
  placeholder-looking ones.** Replace the current table (which has a literal
  connection-string-shaped example) with a short pointer: list variable names
  and one-line descriptions only, and tell the reader to copy `.env.example`
  and fill in their own values. No `DATABASE_URL`/`PORT` sample values appear
  anywhere in README.md. This is a standing rule, not specific to this change —
  `.env.example` itself is the only place env values live, and it's gitignored
  from automated commits during this project's development.

## Out of scope

- No changes to `enricher.ts`, `job.ts`, `dataCleaner.ts`, routes, or the report
  HTML — this change is scoped to `validator.ts` and `cleaner.ts` plus their
  direct test/fixture/README fallout.
- No new configurable thresholds (50%, 90%) exposed via environment variables or
  config — they're fixed constants in code, matching the existing pattern (e.g.
  the date-name heuristic is also a fixed rule).
