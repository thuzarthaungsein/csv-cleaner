import { Hono } from "hono"
import { mkdir, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
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
        const safeName = basename(file.name)
        const fileName = `${Date.now()}_${safeName}`
        const filePath = join(UPLOAD_DIR, fileName)
        const buffer = Buffer.from(await file.arrayBuffer())
        await writeFile(filePath, buffer)

        try {
            const result = await runPipeline(filePath, countryCache)

            if (result.status === "done") {
                return c.json({ jobId: result.jobId, status: result.status, fileName })
            }

            return c.json(
                { jobId: result.jobId, status: result.status, fileName, errorMessage: result.errorMessage },
                500,
            )
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return c.json({ error: "pipeline failed to start", message }, 500)
        }
    })

    return route
}
