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

        for (const column of REQUIRED_COLUMNS) {
            if (!columnNames.includes(column)) {
                errors.push({ column, issue: "missing_column", count: 0 })
                continue
            }
            const isVarchar = columnTypes.get(column) === "VARCHAR"
            const nullCondition = isVarchar
                ? `"${column}" IS NULL OR "${column}" = ''`
                : `"${column}" IS NULL`
            const [{ nullCount }] = await db.all(
                `SELECT COUNT(*)::INT AS "nullCount" FROM read_csv_auto('${escapedPath}') WHERE ${nullCondition}`,
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
