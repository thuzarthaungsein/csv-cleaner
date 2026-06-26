import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { buildUploadRoute } from "./routes/upload.js"
import { buildReportRoute } from "./routes/report.js"
import { buildLandingRoute } from "./routes/landing.js"
import { fetchCountryCache } from "./services/enricher.js"

const app = new Hono()

app.get("/health", (c) => {
    return c.json({ status: "ok" })
})

const countryCache = await fetchCountryCache()
app.route("/", buildLandingRoute())
app.route("/upload", buildUploadRoute(countryCache))
app.route("/report", buildReportRoute())

const port = Number(process.env.PORT) || 3000

serve({ fetch: app.fetch, port }, (info) => {
    console.log(`csv-cleaner listening on http://localhost:${info.port}`)
})
