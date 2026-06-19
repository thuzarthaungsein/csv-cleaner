import { serve } from "@hono/node-server"
import { Hono } from "hono"

const app = new Hono()

app.get("/health", (c) => {
    return c.json({ status: "ok" })
})

const port = Number(process.env.PORT) || 3000

serve({ fetch: app.fetch, port }, (info) => {
    console.log(`csv-cleaner listening on http://localhost:${info.port}`)
})
