# csv-cleaner

Hono + TypeScript ETL API. Uploads CSV → validates → cleans → enriches → serves chart report.

## Commands

- Dev: `npm run dev`
- Build: `npm run build`
- Start: `npm start`
- DB up: `docker compose up -d`
- DB shell: `docker exec -it csv_cleaner_db psql -U csv_user -d csv_cleaner`

## Architecture

- Handlers in `src/routes/` — thin only, no business logic
- Business logic in `src/services/` — validator, cleaner, enricher
- DB operations in `src/repositories/job.ts` only — never query DB from routes or services directly
- Pipeline orchestration in `src/agents/dataCleaner.ts`

## ETL Pipeline Order

1. validate (data-validate skill) → 2. clean (csv-data-normalizer agent) → 3. enrich → 4. save job → 5. report

Never skip validation. Always run data-validate before cleaning.

## Skills

- data-validate: `.claude/skills/data-validate.md` — run before any clean step

## Agents

- csv-data-normalizer: `.claude/agents/csv-data-normalizer.md` — runs after validate
- code-reviewer: `.claude/agents/code-reviewer.md` — run after each feature, before commit

## Plugins

- code-review@claude-plugins-official — general quality + security checks
- commit-commands@claude-plugins-official — Conventional Commits formatting

## Key Rules

- Never overwrite source uploads in `uploads/` — write cleaned output to `outputs/` only
- Never hardcode secrets — always read from `process.env`
- Enrichment is optional — skip gracefully if no country column detected in CSV
- snake_case for DB fields, camelCase for variables, PascalCase for classes
- 4 spaces indent, no semicolons, trailing commas allowed

## Do Not Touch

- `init.sql` — DB schema source of truth, don't modify without discussion
- `.env` — never commit, never hardcode values from it
- `uploads/` — raw source files, never mutate

## Skills and Agents — important note

Skills and agents in `.claude/` are development-time blueprints for Claude Code.
They are NOT imported or called at runtime.

- data-validate.md → blueprint for validator.ts
- csv-data-normalizer.md → blueprint for cleaner.ts
  Implement the logic described in each file as regular TypeScript services.

## Workflow rule

After each feature:

1. Run code-reviewer agent (ETL architecture check)
2. Run code-review plugin (general quality check)
3. Use commit-commands plugin to format and commit

## README

Always keep README.md up to date when:

- A new feature is implemented
- The ETL pipeline flow changes

README.md must include:

- Project overview and ETL pipeline diagram
- Setup instructions with exact commands
- curl examples for every endpoint
- Environment variables table
