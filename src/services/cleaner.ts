import { Database } from "duckdb-async"
import { basename, extname, join } from "node:path"

export interface CleanResult {
    outputPath: string
    rowCountBefore: number
    rowCountAfter: number
}

const EMAIL_COLUMN_NAMES = ["email", "e_mail", "email_address"]

function quoteIdent(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`
}

export async function cleanCsv(filePath: string, outputDir: string): Promise<CleanResult> {
    const db = await Database.create(":memory:")

    try {
        const escapedInput = filePath.replace(/'/g, "''")

        const [{ rowCountBefore }] = await db.all(
            `SELECT COUNT(*)::INT AS "rowCountBefore" FROM read_csv_auto('${escapedInput}')`,
        )

        const columns = await db.all(
            `DESCRIBE SELECT * FROM read_csv_auto('${escapedInput}')`,
        )
        const columnNames = columns.map((c: Record<string, unknown>) => String(c.column_name))
        const columnTypes = new Map(
            columns.map((c: Record<string, unknown>) => [String(c.column_name), String(c.column_type)]),
        )

        const selectParts = columnNames.map((column) => {
            const lower = column.toLowerCase()
            const isVarchar = columnTypes.get(column) === "VARCHAR"
            const quoted = quoteIdent(column)
            if (EMAIL_COLUMN_NAMES.includes(lower)) {
                return isVarchar
                    ? `NULLIF(LOWER(TRIM(${quoted})), '') AS ${quoted}`
                    : quoted
            }
            if (lower.includes("date")) {
                return isVarchar
                    ? `TRY_CAST(TRIM(${quoted}) AS DATE) AS ${quoted}`
                    : quoted
            }
            return isVarchar
                ? `NULLIF(TRIM(${quoted}), '') AS ${quoted}`
                : quoted
        })

        const baseName = basename(filePath, extname(filePath))
        const outputPath = join(outputDir, `${baseName}_cleaned.csv`)
        const escapedOutput = outputPath.replace(/'/g, "''")

        await db.exec(`
            COPY (
                SELECT DISTINCT ${selectParts.join(", ")}
                FROM read_csv_auto('${escapedInput}')
            ) TO '${escapedOutput}' (HEADER, DELIMITER ',')
        `)

        const [{ rowCountAfter }] = await db.all(
            `SELECT COUNT(*)::INT AS "rowCountAfter" FROM read_csv_auto('${escapedOutput}')`,
        )

        return { outputPath, rowCountBefore, rowCountAfter }
    } finally {
        await db.close()
    }
}
