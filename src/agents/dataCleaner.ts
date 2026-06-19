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
