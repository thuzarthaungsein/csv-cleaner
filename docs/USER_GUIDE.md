# CSV Cleaner — User Guide

**Live site:** [YOUR-APP-URL] *(replace with your Render URL, e.g. `https://csv-cleaner.onrender.com`)*

## What is this?

CSV Cleaner is a free, browser-based tool that takes a messy CSV file and gives
you back a cleaned-up version — plus a visual report showing what changed.

No installation, no account, no command line. Just open the site, upload a
file, and see the results.

## What you get

When you upload a CSV, the tool automatically:

1. **Checks your data for problems** — empty columns, mostly-empty columns,
   duplicate rows, and columns that look like they should be numbers or dates
   but have stray text in them.
2. **Cleans it up** — trims extra whitespace, fixes inconsistent date formats,
   lowercases email addresses, removes exact duplicate rows, and turns empty
   text into proper blanks.
3. **Enriches it (if it's about countries)** — if your file has a column with
   country names or country codes, the tool automatically looks each one up
   and adds region and ISO code information.
4. **Shows you a report** — row counts before and after cleaning, what got
   enriched, and easy-to-read charts.
5. **Lets you download the cleaned file** — one click to get the finished CSV.

You can upload as many files as you like, one at a time.

## Step by step

### 1. Open the site

Go to **[YOUR-APP-URL]** in any web browser (Chrome, Safari, Firefox, Edge —
no extensions or sign-in needed).

### 2. Choose your CSV file

You'll see a dashed box in the middle of the page. Either:

- **Drag your CSV file** from your computer and drop it onto the box, or
- **Click the box** to open a file picker and select your CSV file.

Once a file is selected, the box turns green and shows the filename and size.

### 3. Click "Upload"

The button becomes active once a file is selected. Click it. You'll see a
spinner and "Processing..." while the tool checks and cleans your file — this
usually takes a few seconds.

### 4. See your report

The page updates (no reload, no new tab) to show:

- A **status badge** (Done)
- A **summary table**: filename, row counts before/after, which columns got
  enriched, how many rows were skipped
- **Validation findings**, if any were found — for example a duplicate-row
  count or an empty column — shown as extra rows in the summary table (in red
  for more serious issues, amber for minor ones). Your file still gets
  cleaned even when findings are present; the findings are just there to tell
  you what was found and (where applicable) fixed.
- **Two charts**: one comparing row counts before and after cleaning, and one
  showing what percentage of rows were successfully enriched (if applicable)
- A **"Download Cleaned CSV" button** — click it to save the finished file to
  your computer

### 5. If something goes wrong

A red error message appears on the same page only if something genuinely
prevents processing — for example the server couldn't read the uploaded
file. Data-quality issues in your CSV (duplicate rows, an empty column, and
so on) do **not** stop processing — they're cleaned where possible and shown
as findings in the report instead (see step 4). The Upload button becomes
available again after either outcome so you can try another file.

### 6. Upload another file

No need to reload the page. Just select a new file and click Upload again.

## What kind of CSV file works best?

Any CSV works — there's no required column names or fixed format, and the
tool always tries to clean and process your file rather than rejecting it
outright. A few things to know:

- **Completely empty columns** (every row blank) are flagged as a finding in
  your report, but your file still gets processed — the empty column just
  stays empty in the cleaned output.
- **Fully duplicate rows** (two or more rows identical in every column) are
  automatically removed during cleaning, and the report tells you how many
  duplicate rows were found and removed.
- **Country enrichment** only happens automatically if one of your columns is
  named something like `country`, `country_name`, `country_code`, `iso_code`,
  `iso2`, or `iso3` and contains country names or ISO codes.
- There's no file size limit built into the tool itself, but very large files
  will simply take longer to process.

## A note on file storage

This is a demo deployment. Uploaded files and cleaned results are **not
stored permanently** — if the server restarts (which can happen automatically
on the free hosting tier after periods of inactivity), previously uploaded
files and their reports are not preserved. Always download your cleaned CSV
right away if you want to keep it.

## Questions or issues?

This is a demo project. If something doesn't work as described above, the
underlying code and technical documentation are in this repository's main
[README](../README.md).
