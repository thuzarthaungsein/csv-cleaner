import { basename } from "node:path"
import { mkdir } from "node:fs/promises"
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
    // No job id exists yet, so a createJob failure cannot be recorded via failJob.
    // Callers (e.g. the future upload route) should expect runPipeline to potentially reject if job creation itself fails.
    const job = await createJob(basename(filePath))

    try {
        const validation = await validateCsv(filePath)
        await updateJobStatus(job.id, "validated")

        if (!validation.valid) {
            const message = `validation failed: ${JSON.stringify(validation.errors)}`
            await failJob(job.id, message)
            return { jobId: job.id, status: "failed", errorMessage: message }
        }

        await mkdir(OUTPUT_DIR, { recursive: true })
        const cleanResult = await cleanCsv(filePath, OUTPUT_DIR)
        await updateJobStatus(job.id, "cleaned")

        const enrichResult = await enrichCsv(cleanResult.outputPath, OUTPUT_DIR, countryCache)
        if (enrichResult.enriched) {
            await updateJobStatus(job.id, "enriched")
        }

        const finalOutputPath = enrichResult.enriched
            ? enrichResult.outputPath
            : cleanResult.outputPath

        await completeJob(job.id, {
            rowCountBefore: validation.rowCount,
            rowCountAfter: cleanResult.rowCountAfter,
            enrichedApi: enrichResult.enriched ? "mledoze/countries" : null,
            enrichedColumns: enrichResult.enrichedColumns,
            skippedRows: enrichResult.skippedRows,
            outputPath: finalOutputPath,
        })

        return { jobId: job.id, status: "done" }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        try {
            await failJob(job.id, message)
        } catch (secondaryError) {
            console.error("failJob threw while handling pipeline error:", secondaryError)
        }
        return { jobId: job.id, status: "failed", errorMessage: message }
    }
}
