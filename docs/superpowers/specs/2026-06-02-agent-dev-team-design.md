# Agent Dev Team — Design Spec

Date: 2026-06-02
Status: Approved

## Objective

Set up a CampBrain-specific "dev team" of Claude Code subagents that orchestrate,
architect, plan, build, test, debug, and document the codebase. Replace the current
`AGENTS.md` (a stale copy of `CLAUDE.md`) with a real agent roster, and give each
agent loadable CampBrain context so spawned subagents start with the right
conventions, stack knowledge, and file ownership.

## Approach (chosen: B, refined)

- **`.claude/agents/*.md`** — the operational, loadable agent definitions. Claude Code
  loads these as subagents. Each holds full CampBrain-specific context (stack, file
  ownership, conventions, handoffs). These ARE the role cards — single source of truth.
- **`AGENTS.md`** — lean human-readable roster: one row per agent (name, model,
  mandate, owned files, pointer to its `.claude/agents/` definition).
- **`CLAUDE.md`** — add an `## Agent Team` pointer section + a note in Conventions that
  the Documentation Steward owns doc/spec freshness.

Refinement vs. original plan: the originally-proposed `docs/agents/` role cards are
dropped to avoid maintaining two copies of each agent's context. `.claude/agents/*.md`
serves that purpose and is actually loaded by the harness.

## Roster

| Agent | Model | Owns | Mandate |
|---|---|---|---|
| Architect | opus | `docs/superpowers/specs/` | Designs features before code; produces specs |
| Planner | opus | implementation plans | Translates approved specs into ordered, dependency-aware plans |
| Backend Developer | sonnet | `src/` | Scanner, cache, DB, CLI, API routes, provider adapters |
| Frontend Developer | sonnet | `web/` | Next.js pages, components, API consumers |
| Reviewer | sonnet (escalate opus) | diffs | Correctness, conformance, structural quality |
| Debugger | sonnet | bugs | Evidence-based investigation before any fix |
| Tester | sonnet | `test/` | Vitest tests, edge-case coverage |
| Documentation Steward | sonnet (opus for full reconcile) | docs/specs/CLAUDE.md/AGENTS.md | Keeps artifacts in sync with shipped code |

Model rationale: Opus for the two reasoning-heavy upstream roles (Architect, Planner).
Sonnet for execution. Reviewer defaults Sonnet but escalates to Opus for high-risk
diffs. Tester stays on Sonnet (test design is judgment-heavy — this project has had
subtle correctness bugs: dedupe-across-windows, TTL boundaries, walk-up exclusion,
weekend tier math). Haiku is intentionally not used for any agent; mechanical
check-running is handled by a hook, not an agent.

## Per-Agent Context (each `.claude/agents/*.md`)

Each definition includes frontmatter (`name`, `description` with trigger examples,
`tools`, `model`) and a body covering:
- Role and what they own / explicitly do NOT touch (file boundaries)
- CampBrain stack facts relevant to them (Postgres schema, 8-day windows, MV, provider
  adapter isolation, Next.js 14 + Leaflet, dedupe-across-windows gotcha)
- Project guardrails (no auto-booking / CAPTCHA bypass / login automation / proxy
  rotation / high-frequency scraping; TypeScript strict, no `any`; kebab-case files)
- Handoff protocol (who they receive from, who they hand to)
- Verification expectations (`npm run typecheck`, `npm test`, `npm run verify`)

## Documentation Steward — dual trigger

1. **On-demand skill** (`doc-steward`) — full knowledge-base reconciliation: scans the
   diff/recent commits and reconciles CLAUDE.md "Next Steps", AGENTS.md roster, specs in
   `docs/superpowers/specs/`, and goal docs in `docs/`. Run when a feature ships.
2. **Post-task hook** (Stop hook in `.claude/settings.json`) — lightweight automatic
   check that flags when source changed but docs likely went stale, prompting a steward
   pass. Cheap; does not itself rewrite docs.

## CLAUDE.md changes (minimal)

1. New `## Agent Team` section: roster summary + pointer to AGENTS.md and
   `.claude/agents/`.
2. Conventions note: the Documentation Steward owns CLAUDE.md/spec freshness; other
   agents defer doc updates to it rather than editing ad-hoc.

## Out of scope

- SDK / API autonomous pipeline (no headless multi-agent runner)
- Haiku check-runner agent (handled by hook)
- Any change to provider scraping behavior or booking automation
- `docs/agents/` duplicate role cards

## Success criteria

- `AGENTS.md` is a real roster, not a CLAUDE.md copy.
- 8 loadable agents exist under `.claude/agents/` with CampBrain context + correct models.
- Documentation Steward exists as both a skill and a post-task hook.
- CLAUDE.md points to the team; `npm run typecheck` still passes (no code touched).
