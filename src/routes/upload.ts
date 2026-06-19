import { Hono } from "hono"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
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
        const fileName = `${Date.now()}_${file.name}`
        const filePath = join(UPLOAD_DIR, fileName)
        const buffer = Buffer.from(await file.arrayBuffer())
        await writeFile(filePath, buffer)

        const result = await runPipeline(filePath, countryCache)

        return c.json({ jobId: result.jobId, status: result.status, fileName })
    })

    return route
}
