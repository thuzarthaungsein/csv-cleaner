# Landing Page with Inline Upload — Design

Date: 2026-06-26

## Purpose

Today the only way to use this API is `curl`/Postman against `POST /upload` and
then visiting `/report/:id` separately. Add a real landing page at `GET /` where
a user can drag-and-drop or browse for a CSV, upload it, and see the resulting
report appear on the same page — no redirect, no page reload.

## Visual design (confirmed via brainstorming companion)

Page layout, top to bottom:
1. Title ("CSV Cleaner") + one-line description
2. A 4-step pipeline strip (Validate → Clean → Enrich → Report), purely
   informational, numbered circles with short captions
3. A drag-and-drop dropzone with three states:
   - **Idle**: dashed gray border, up-arrow icon, "Drag & drop your CSV here /
     or click to browse"
   - **Drag-over**: blue dashed border, blue background tint, "Drop to upload"
   - **File selected**: solid green border, green tint, checkmark, filename +
     size, "click to change"
4. An Upload button — disabled with a spinner while a request is in flight
5. An empty result container below the form, populated after upload:
   - Success: the injected report fragment (summary table + charts + Download
     CSV button)
   - Failure: a red inline error banner with the pipeline's `errorMessage`

## Architecture

### New route: `GET /`

A new file, `src/routes/landing.ts`, exports `buildLandingRoute()` returning a
Hono router mounted at the root in `index.ts`. Serves a single full HTML
document (Tailwind CDN + Chart.js CDN, matching `report.ts`'s existing visual
language) with an inline `<script>` block — the project's first client-side
JavaScript.

### Client-side JS (inline on the landing page)

- Dropzone: wires `dragenter`/`dragover`/`dragleave`/`drop` and a hidden
  `<input type="file">` for the click-to-browse path. Updates the dropzone's
  visual state and enables the Upload button once a file is present.
- Upload button click handler:
  1. Disable the button, show a spinner.
  2. `fetch("/upload", { method: "POST", body: FormData })`.
  3. On `status === "done"`: `fetch("/report/" + jobId + "/fragment")`, inject
     the returned `html` into the result container, then call `new Chart(...)`
     directly using the returned `chartData` (no embedded `<script>`
     re-execution needed — `innerHTML` does not execute injected `<script>`
     tags, so chart construction happens in the landing page's own already-
     loaded script using the data the fragment endpoint returns).
  4. On `status === "failed"` (or a thrown/network error): render the red
     error banner using `errorMessage` from the `/upload` response.
  5. Re-enable the button in all cases (success or failure) so the user can
     upload another file without reloading the page.

### `src/routes/report.ts` changes

- Extract a new function `renderReportFragment(job: Job): { html: string;
  chartData: { rowBefore: number; rowAfter: number; wasEnriched: boolean;
  coverage: number } }`. `html` is the existing summary table + chart
  `<canvas>` markup + Download CSV button (everything inside `renderDone`'s
  `<body>` today, minus the `<script>` block). `chartData` carries the values
  the charts need, instead of embedding them in a `<script>` string.
- `renderDone` (used by the existing full-page `GET /:id` route) calls
  `renderReportFragment`, wraps its `html` in the full document shell exactly
  as today, and writes its own `<script>` tag building the charts from
  `chartData` — visually identical output to today, just sourced from the
  shared fragment function instead of duplicating the markup.
- New route: `GET /report/:id/fragment`. Only valid for `status === "done"`
  jobs — this fragment endpoint is exclusively consumed by the landing page's
  JS immediately after a successful upload, so it does not need to handle
  in-progress or failed states (those are rendered by the landing page itself
  from the `/upload` JSON response, never by fetching this endpoint).
  - Job not found → `404` JSON `{ error: "job not found" }`.
  - Job found but `status !== "done"` → `400` JSON `{ error: "job not
    finished" }` (matches the existing `/download` route's error shape).
  - Otherwise → `200` JSON `{ html: string, chartData: {...} }` (the return
    value of `renderReportFragment`).

### `index.ts` changes

Mount the new route: `app.route("/", buildLandingRoute())`, alongside the
existing `/upload` and `/report` mounts.

## Out of scope

- No changes to `POST /upload`'s existing JSON contract — curl/API consumers
  see no difference.
- No changes to `GET /report/:id`'s existing behavior or visual output.
- No automated UI/browser test — this is the project's first client-side JS;
  verification is a manual browser smoke test (drag-and-drop, click-to-browse,
  successful upload, failed upload, re-upload after failure), consistent with
  how this project has handled UI changes so far (manual verification + the
  existing automated tests for backend routes/services).
- No upload progress percentage, no multi-file upload, no file-type/size
  client-side validation beyond what the backend already enforces.

## Testing

- `src/routes/report.ts`: unit tests for `renderReportFragment`'s output
  (same content assertions `renderDone`'s tests already make, applied to the
  extracted fragment function) and a `renderDone` regression test confirming
  the full-page output is unchanged.
- New tests for `GET /report/:id/fragment`: 404 missing job, 400 not-done job,
  200 with correct `html`/`chartData` shape for a real done job.
- Manual smoke test script (documented in the implementation plan): start dev
  server, open `/` in a browser, drag a valid CSV, confirm dropzone state
  changes, click Upload, confirm spinner then injected report+charts appear;
  repeat with a CSV that fails validation and confirm the error banner
  appears and the button re-enables for a retry.
