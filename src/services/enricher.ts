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
        const response = await fetch("https://raw.githubusercontent.com/mledoze/countries/master/countries.json")
        if (!response.ok) {
            console.warn(`country data fetch failed with status ${response.status}; enrichment disabled`)
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
        console.warn("country data fetch threw; enrichment disabled:", error)
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
    let lookupPath: string | undefined

    try {
        const escapedInput = filePath.replace(/'/g, "''")

        const columns = await db.all(`DESCRIBE SELECT * FROM read_csv_auto('${escapedInput}')`)
        const columnNames = columns.map((c: Record<string, unknown>) => String(c.column_name))
        const countryColumn = findCountryColumn(columnNames)

        if (!countryColumn) {
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

        lookupPath = join(tmpdir(), `country-lookup-${randomUUID()}.json`)
        await writeFile(lookupPath, JSON.stringify(lookupRows))
        const escapedLookup = lookupPath.replace(/'/g, "''")
        const escapedOutput = outputPath.replace(/'/g, "''")

        try {
            await db.exec(`
                COPY (
                    SELECT src.*, lookup.region, lookup.cca3
                    FROM read_csv_auto('${escapedInput}') AS src
                    POSITIONAL JOIN read_json_auto('${escapedLookup}') AS lookup
                ) TO '${escapedOutput}' (HEADER, DELIMITER ',')
            `)
        } catch {
            await db.exec(`
                COPY (
                    SELECT src.* EXCLUDE (rn), lookup.region, lookup.cca3
                    FROM (
                        SELECT *, ROW_NUMBER() OVER () AS rn
                        FROM read_csv_auto('${escapedInput}')
                    ) AS src
                    JOIN (
                        SELECT *, ROW_NUMBER() OVER () AS rn
                        FROM read_json_auto('${escapedLookup}')
                    ) AS lookup
                    ON src.rn = lookup.rn
                ) TO '${escapedOutput}' (HEADER, DELIMITER ',')
            `)
        }

        return {
            enriched: true,
            outputPath,
            enrichedColumns: ["region", "cca3"],
            matchedRows,
            skippedRows,
        }
    } finally {
        await db.close()
        if (lookupPath) {
            await unlink(lookupPath).catch(() => {})
        }
    }
}
