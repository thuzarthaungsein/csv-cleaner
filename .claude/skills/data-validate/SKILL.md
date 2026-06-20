---
name: data-validate
description: Schema and sanity checks on any CSV loaded into DuckDB.
---

# Skill: data-validate

## Purpose

Schema and sanity checks on any CSV loaded into DuckDB.

## Steps

1. Load the CSV into DuckDB: `SELECT * FROM read_csv_auto('uploads/<file>')`
2. Detect columns automatically from the header — no column names are required by name
3. Flag any column where ALL values are null/empty as an error (`empty_column`)
4. Flag any column where more than 50% of values are null/empty (but not 100%) as a warning (`high_null_ratio`) — mutually exclusive with `empty_column` per column
5. Detect type mismatches: a VARCHAR column with "date" in its name (`type_mismatch`), or a VARCHAR column where ≥90% of non-null values look numeric (`numeric_mismatch`)
6. Count fully-duplicate rows (every column identical) as an error (`duplicate_row`, `column: "*"`); count is the total number of duplicate rows, summed across all duplicate groups
7. Report findings as structured JSON

## Output contract

    {
      "valid": true | false,
      "rowCount": number,
      "errors": [{ "column": string, "issue": "empty_column" | "duplicate_row", "count": number }],
      "warnings": [{ "column": string, "issue": "high_null_ratio" | "numeric_mismatch" | "type_mismatch" }]
    }

`duplicate_row` errors use `"column": "*"` since the check is full-row, not single-column.

## Rules

- Never mutate the source file
- Always return the report before proceeding to clean step
