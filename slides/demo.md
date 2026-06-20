---
marp: true
paginate: true
transition: fade
# PechaKucha: 6 slides, 20s auto-advance. Do not change the count.
auto-advance: 20
---

<!-- slide 1 -->

# Who's my person?

- A data analyst or backend developer
- Receives messy CSVs from clients or external sources
- Spends hours manually cleaning before doing any real work

<!-- 20s -->

---

<!-- slide 2 -->

# Their problem

- Raw CSVs have nulls, duplicates, inconsistent formats
- No country/region context on location-based data
- Manual cleaning is repetitive, error-prone, not reproducible

<!-- 20s -->

---

<!-- slide 3 -->

# What I built

- CSV Cleaner ETL API — upload any CSV, get a clean + enriched version back
- Validates → deduplicates → normalizes → enriches with country data
- Visual HTML report showing before/after row counts + enrichment summary

<!-- 20s -->

---

<!-- slide 4 -->

# How I built it

- **MCP:** filesystem (CSV read/write) · postgres (job tracking)
- **Skill:** data-validate — schema checks + null detection via DuckDB
- **Agent:** csv-data-normalizer — dedupe + normalize → outputs cleaned CSV
- **Agent:** code-reviewer — ETL architecture check before every commit

<!-- 20s -->

---

<!-- slide 5 -->

# Why it matters

- Works with any CSV structure — no hardcoded column requirements
- Enrichment auto-skipped gracefully if no country column detected
- Every job tracked with status, row counts, and full error trail

<!-- 20s -->

---

<!-- slide 6 -->

# Done checklist

- [x] repo public
- [x] MCP + skill + agent used
- [x] report.md in team repo
- [x] slides/pitch.md added (Marp 6x20 PechaKucha format)
- [x] ETL pipeline implemented (validate → clean → enrich → done/failed)
- [x] DuckDB used for all CSV processing (read_csv_auto, dynamic column detection)
- [x] country enrichment via mledoze/countries (no API key, graceful skip)
- [x] job status tracked in PostgreSQL (pending → validated → cleaned → enriched → done)
- [x] HTML report with Chart.js + Tailwind (before/after row counts + enrichment summary)
- [x] validator dynamic — works with any CSV structure, no hardcoded columns
- [x] Conventional Commits format used throughout git history
- [x] code-reviewer agent run before each commit
- [x] Dockerfile + docker-compose.yml included
- [x] .env.example provided, no secrets committed
- [x] README.md with setup, curl examples
