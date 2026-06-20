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
            SELECT SUM(group_count)::INT AS "dupCount" FROM (
                SELECT COUNT(*) AS group_count FROM read_csv_auto('${escapedPath}')
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
