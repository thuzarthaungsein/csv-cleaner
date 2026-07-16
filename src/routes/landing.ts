import { Hono } from "hono"

function renderLandingPage(): string {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>CSV Cleaner</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-gray-50 p-8">
    <div class="max-w-3xl mx-auto space-y-6">
        <div class="text-center">
            <h1 class="text-2xl font-bold text-gray-900">CSV Cleaner</h1>
            <p class="text-gray-500 text-sm mt-1">Upload, validate, clean, enrich your CSV in one step</p>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div class="bg-white rounded-lg p-4 text-center border border-gray-100">
                <div class="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm mx-auto mb-2">1</div>
                <div class="font-semibold text-xs text-gray-800">Validate</div>
                <div class="text-xs text-gray-400 mt-1">Schema &amp; data checks</div>
            </div>
            <div class="bg-white rounded-lg p-4 text-center border border-gray-100">
                <div class="w-7 h-7 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold text-sm mx-auto mb-2">2</div>
                <div class="font-semibold text-xs text-gray-800">Clean</div>
                <div class="text-xs text-gray-400 mt-1">Dedupe &amp; normalize</div>
            </div>
            <div class="bg-white rounded-lg p-4 text-center border border-gray-100">
                <div class="w-7 h-7 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-sm mx-auto mb-2">3</div>
                <div class="font-semibold text-xs text-gray-800">Enrich</div>
                <div class="text-xs text-gray-400 mt-1">Country data join</div>
            </div>
            <div class="bg-white rounded-lg p-4 text-center border border-gray-100">
                <div class="w-7 h-7 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-sm mx-auto mb-2">4</div>
                <div class="font-semibold text-xs text-gray-800">Report</div>
                <div class="text-xs text-gray-400 mt-1">Charts &amp; summary</div>
            </div>
        </div>

        <div class="bg-white rounded-xl shadow p-6 border border-gray-100">
            <div class="mb-6 bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-gray-700 space-y-2">
                <p><span class="font-semibold text-gray-900">What to upload:</span> any CSV file with a header row. Column names and order don't matter — the tool inspects your file's actual columns.</p>
                <p><span class="font-semibold text-gray-900">What gets validated:</span> fully empty columns and duplicate rows are flagged as errors, and columns more than half empty, columns named like a date, and text columns that look mostly numeric are flagged as warnings. Validation never blocks your upload — findings are shown in the report.</p>
                <p><span class="font-semibold text-gray-900">What gets cleaned:</span> emails are trimmed and lowercased, dates are normalized, blank values become empty, and duplicate rows are removed.</p>
                <p><span class="font-semibold text-gray-900">Optional enrichment:</span> if your CSV has a country column (<code class="font-mono text-xs bg-white px-1 py-0.5 rounded border border-blue-200">country</code>, <code class="font-mono text-xs bg-white px-1 py-0.5 rounded border border-blue-200">country_name</code>, <code class="font-mono text-xs bg-white px-1 py-0.5 rounded border border-blue-200">country_code</code>, <code class="font-mono text-xs bg-white px-1 py-0.5 rounded border border-blue-200">iso_code</code>, <code class="font-mono text-xs bg-white px-1 py-0.5 rounded border border-blue-200">iso2</code>, or <code class="font-mono text-xs bg-white px-1 py-0.5 rounded border border-blue-200">iso3</code>), region and ISO-3 columns are added to a separate enriched download — your cleaned file always keeps only your original columns.</p>
            </div>

            <div id="dropzone" class="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer transition-colors">
                <div id="dropzoneIdle">
                    <div class="text-3xl mb-2">&#8593;</div>
                    <div class="font-semibold text-sm text-gray-700">Drag &amp; drop your CSV here</div>
                    <div class="text-xs text-gray-400 mt-1">or click to browse</div>
                </div>
                <div id="dropzoneSelected" class="hidden">
                    <div class="text-3xl mb-2 text-green-600">&#10003;</div>
                    <div id="selectedFileName" class="font-semibold text-sm text-green-800"></div>
                    <div id="selectedFileSize" class="text-xs text-gray-500 mt-1"></div>
                </div>
                <input type="file" id="fileInput" accept=".csv" class="hidden">
            </div>

            <button id="uploadButton" disabled class="w-full mt-4 px-4 py-3 rounded-lg bg-blue-600 text-white font-semibold text-sm shadow hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <span id="uploadButtonSpinner" class="hidden w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                <span id="uploadButtonText">Upload</span>
            </button>

            <div id="errorBanner" class="hidden mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2 items-start">
                <span class="text-red-600 font-bold">&#9888;</span>
                <div>
                    <div class="font-semibold text-xs text-red-800">Upload failed</div>
                    <div id="errorBannerMessage" class="text-xs text-red-700 mt-1 font-mono"></div>
                </div>
            </div>
        </div>

        <div id="resultContainer" class="space-y-6"></div>
    </div>

    <script>
        const dropzone = document.getElementById("dropzone")
        const dropzoneIdle = document.getElementById("dropzoneIdle")
        const dropzoneSelected = document.getElementById("dropzoneSelected")
        const selectedFileName = document.getElementById("selectedFileName")
        const selectedFileSize = document.getElementById("selectedFileSize")
        const fileInput = document.getElementById("fileInput")
        const uploadButton = document.getElementById("uploadButton")
        const uploadButtonSpinner = document.getElementById("uploadButtonSpinner")
        const uploadButtonText = document.getElementById("uploadButtonText")
        const errorBanner = document.getElementById("errorBanner")
        const errorBannerMessage = document.getElementById("errorBannerMessage")
        const resultContainer = document.getElementById("resultContainer")

        let selectedFile = null

        function formatFileSize(bytes) {
            if (bytes < 1024) return bytes + " B"
            return (bytes / 1024).toFixed(1) + " KB"
        }

        function setFile(file) {
            selectedFile = file
            dropzoneIdle.classList.add("hidden")
            dropzoneSelected.classList.remove("hidden")
            selectedFileName.textContent = file.name
            selectedFileSize.textContent = formatFileSize(file.size) + " \\u00b7 click to change"
            dropzone.classList.remove("border-blue-500", "bg-blue-50")
            dropzone.classList.add("border-green-500", "bg-green-50")
            uploadButton.disabled = false
        }

        dropzone.addEventListener("click", () => fileInput.click())

        fileInput.addEventListener("change", () => {
            if (fileInput.files.length > 0) {
                setFile(fileInput.files[0])
            }
        })

        dropzone.addEventListener("dragover", (event) => {
            event.preventDefault()
            dropzone.classList.add("border-blue-500", "bg-blue-50")
        })

        dropzone.addEventListener("dragleave", () => {
            if (!selectedFile) {
                dropzone.classList.remove("border-blue-500", "bg-blue-50")
            }
        })

        dropzone.addEventListener("drop", (event) => {
            event.preventDefault()
            if (event.dataTransfer.files.length > 0) {
                setFile(event.dataTransfer.files[0])
            }
        })

        function showError(message) {
            errorBannerMessage.textContent = message
            errorBanner.classList.remove("hidden")
        }

        function hideError() {
            errorBanner.classList.add("hidden")
        }

        function setLoading(isLoading) {
            uploadButton.disabled = isLoading
            uploadButtonSpinner.classList.toggle("hidden", !isLoading)
            uploadButtonText.textContent = isLoading ? "Processing..." : "Upload"
        }

        function renderChartsInto(chartData) {
            new Chart(document.getElementById("rowCountChart"), {
                type: "bar",
                data: {
                    labels: ["Before", "After"],
                    datasets: [{ label: "Row count", data: [chartData.rowBefore, chartData.rowAfter], backgroundColor: ["#94a3b8", "#3b82f6"] }],
                },
            })
            if (chartData.wasEnriched) {
                new Chart(document.getElementById("coverageChart"), {
                    type: "bar",
                    data: {
                        labels: ["Enrichment coverage %"],
                        datasets: [{ label: "Coverage", data: [chartData.coverage], backgroundColor: ["#22c55e"] }],
                    },
                    options: { scales: { y: { max: 100 } } },
                })
            }
        }

        async function loadFragment(jobId) {
            const res = await fetch("/report/" + jobId + "/fragment")
            if (!res.ok) {
                throw new Error("could not load report")
            }
            const body = await res.json()
            resultContainer.innerHTML = body.html
            renderChartsInto(body.chartData)
        }

        uploadButton.addEventListener("click", async () => {
            if (!selectedFile) return
            hideError()
            resultContainer.innerHTML = ""
            setLoading(true)

            const formData = new FormData()
            formData.append("file", selectedFile)

            try {
                const res = await fetch("/upload", { method: "POST", body: formData })
                const body = await res.json()

                if (res.ok && body.status === "done") {
                    await loadFragment(body.jobId)
                } else {
                    showError(body.errorMessage || body.message || "Upload failed")
                }
            } catch (error) {
                showError(error.message || "Upload failed")
            } finally {
                setLoading(false)
            }
        })
    </script>
</body>
</html>`
}

export function buildLandingRoute() {
    const route = new Hono()

    route.get("/", (c) => {
        return c.html(renderLandingPage())
    })

    return route
}
