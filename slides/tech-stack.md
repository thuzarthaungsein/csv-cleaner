---
marp: true
paginate: true
transition: fade
auto-advance: 20
---

<!-- slide 1 — cover -->

# CSV Cleaner

**Upload, validate, clean, enrich — and download — your CSV in one step.**

Built with Hono + TypeScript · DuckDB · PostgreSQL · Claude Code

🔗 https://csv-cleaner-qrqn.onrender.com

---

<!-- slide 2 — tech stack -->

# Tech Stack

| Layer          | Technology                                       |
| -------------- | ------------------------------------------------ |
| **API**        | Hono + TypeScript (Node.js)                      |
| **Processing** | DuckDB — reads + transforms CSV via SQL          |
| **Database**   | PostgreSQL (local Docker · production Neon.tech) |
| **Report UI**  | Chart.js + Tailwind CSS via CDN                  |
| **Deploy**     | Dockerfile → Render.com (free tier)              |

---

<!-- slide 3 — agents -->

# Agents

- **csv-data-normalizer** — runs after validation; trims whitespace, deduplicates rows, normalizes dates to ISO 8601, saves cleaned CSV to `outputs/` via DuckDB SQL
- **code-reviewer** — runs after each feature and before every commit; checks layer separation, pipeline order, no hardcoded secrets

---

<!-- slide 4 — skills -->

# Skills

- **data-validate** — blueprint for `validator.ts`; defines how to load any CSV into DuckDB, detect empty columns, type mismatches, and duplicate rows, and return a structured JSON findings report `{ valid, rowCount, errors[], warnings[] }`

> Skills are development-time blueprints for Claude Code — not runtime callables. The skill defines the spec; the TypeScript service is the implementation.

---

<!-- slide 5 — methodology -->

# Methodology

1. **Explore** — brainstorm architecture and API choices in Claude.ai
2. **Plan** — lock folder structure, ETL flow, MCP + skill + agent setup
3. **Build** — execute in Claude Code (VS Code terminal) with subagents
4. **Review** — code-reviewer agent checks each feature before commit
5. **Deploy** — push to GitHub → Render auto-deploys via Dockerfile

Conventional Commits format throughout · one commit per pipeline stage

Powered by **Superpowers** — writing-plans → subagent-driven-development → requesting-code-review skills orchestrated each phase . (brainstorming is skipped)

---

<!-- slide 6 — trigger -->

# Trigger

Each tool runs automatically at a defined point in the development workflow:

| Tool                    | When it runs                                              |
| ----------------------- | --------------------------------------------------------- |
| **data-validate skill** | Start of every pipeline run, before the clean step        |
| **csv-data-normalizer** | After validation completes, unconditionally               |
| **code-reviewer agent** | After each feature is implemented, before every commit    |
| **filesystem MCP**      | During development — reads uploads, writes outputs        |
| **postgres MCP**        | During development — queries and updates the `jobs` table |

---

<!-- slide 7 — commands -->

# Commands

No slash commands — all tools are invoked by Claude Code automatically as part of the workflow defined.

**Dev workflow**

```bash
npm run dev     # start server (loads .env automatically)
npm test        # run test suite against live Postgres
npm run build   # compile TypeScript → dist/
```

**Pipeline stages (one commit each)**

```
validate → clean → enrich → save → report
```

**ETL entry point**

```
POST /upload  →  src/agents/dataCleaner.ts  →  runPipeline()
```
