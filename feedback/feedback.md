<!-- Feedback template. Copy to your repo (e.g. feedback/feedback.md), fill, link in report.md.
     Use ONE of: interview / feedback / open-issues. This one = written feedback you collected. -->

# User Feedback — csv-cleaner

- **How collected:** Written feedback via direct message — 1 user
- **When:** 2026-07-05

## Raw feedback

1. "When I start landed the site, I'm not sure what kinds of csv should upload. The description should shows details for user."
2. "I uploaded a simple CSV file for testing although I'm not sure which fields are being validated."
3. "My CSV contains two duplicate rows for Jane Joe, and the validation error mentions Region and CCA3. However, my CSV doesn't include a Region column."
4. "It appears that only duplicate rows are being validated. I also tested with blank columns (not fully empty row), but no validation error was returned in the summary table."
5. "It would be helpful to include in the description which fields are validated."

## Themes (what keeps coming up)

- Lack of onboarding context — users don't know what the tool expects or how it works before uploading
- Validation output is confusing — error messages reference columns the user didn't upload (region, cca3 from enrichment leaking into validation report)
- Validation scope is unclear — users expect partial nulls to be caught, but only fully empty columns are flagged currently

## Top 3 things to fix

- [ ] **Bug:** validation error messages reference enrichment columns (region, cca3) that don't exist in the user's original CSV — validator must only report on columns present in the uploaded file
- [ ] **Improvement:** add a description/onboarding section on the upload page explaining what the tool does, what CSV formats work, and what gets validated
- [ ] **Improvement:** expand validation to flag columns with partial nulls (e.g. >50% empty) as warnings, not just fully empty columns
