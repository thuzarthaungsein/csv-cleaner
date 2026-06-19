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
