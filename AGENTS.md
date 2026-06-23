# CampBrain Agent Team

The roster of Claude Code subagents for CampBrain. Each agent's full, loadable
definition (with CampBrain-specific context, file ownership, and handoffs) lives in
`.claude/agents/<name>.md` — those files are the single source of truth. This file is the
human-readable map.

Project truth (stack, architecture, conventions) lives in [CLAUDE.md](CLAUDE.md).
The **Documentation Steward** keeps both this roster and CLAUDE.md in sync with shipped code.

## Roster

| Agent | Model | Owns | Mandate |
|---|---|---|---|
| [architect](.claude/agents/architect.md) | opus | `docs/superpowers/specs/` | Designs features before code; produces specs |
| [planner](.claude/agents/planner.md) | opus | implementation plans | Turns approved specs into ordered, dependency-aware plans |
| [backend-developer](.claude/agents/backend-developer.md) | sonnet | `src/`, `web/app/api/` (main); `packages/core`, `packages/db`, `apps/api`, `apps/scanner` (hosted-launch) | Scanner, cache, DB, CLI, provider adapters, API routes |
| [frontend-developer](.claude/agents/frontend-developer.md) | sonnet | `web/app/**`, `web/lib/` (main); `apps/web/src/` (hosted-launch) | Next.js pages, components, Leaflet map, client utils; Vite SPA on hosted-launch |
| [reviewer](.claude/agents/reviewer.md) | sonnet¹ | diffs & plans | Spec compliance gate + correctness, conformance, structural quality |
| [debugger](.claude/agents/debugger.md) | sonnet | bugs | Evidence-based root-cause diagnosis (no fix) |
| [tester](.claude/agents/tester.md) | sonnet | `test/` | Vitest tests, edge-case coverage |
| [doc-steward](.claude/agents/doc-steward.md) | sonnet² | docs, specs, CLAUDE.md, AGENTS.md | Keeps artifacts in sync with shipped code |

¹ Reviewer escalates to Opus for high-risk diffs (schema/MV, scanner, cache-write paths).
² Doc Steward may run on Opus for a full multi-file knowledge-base reconciliation.

## Workflow

```
request → architect (spec) → planner (ordered plan)
        → backend-developer / frontend-developer (build)
        → tester (coverage) → reviewer (gate)
        → debugger (only when a hard bug surfaces)
        → doc-steward (reconcile CLAUDE.md / specs / this roster)
```

- **Opus** for the upstream reasoning roles (architect, planner). **Sonnet** for execution.
- Mechanical check-running (`typecheck`, `test`, `verify`) is handled by hooks, not an agent.
- The Documentation Steward runs two ways: on-demand via the `doc-steward` skill, and a
  lightweight automatic Stop-hook check that flags likely-stale docs after code changes.

## Default pipeline (standing rule)

For any non-trivial feature, change, or new capability:

1. **Always spawn the architect first.** No implementation starts without an approved spec
   in `docs/superpowers/specs/`. Skip this only for bug fixes, typo/style changes, or
   config tweaks that touch no more than ~10 lines.
2. **Always spawn the planner next.** The planner turns the spec into ordered tasks before
   any developer is spawned.
3. **Spawn the right developer** (backend, frontend, or both) to execute each plan step.
4. **Spawn the tester** to cover changed behavior before the reviewer sees it.
5. **Spawn the reviewer** to gate every non-trivial diff. For schema/MV/scanner/cache-write
   changes, explicitly escalate to Opus review.
6. **Run the doc-steward** when a feature is complete. The Stop hook will remind if skipped.

If asked to skip a step, confirm with the user before proceeding — the pipeline exists to
catch the classes of bugs this project has already experienced (dedupe, walk-up leakage,
MV schema drift).

## Guardrails (every agent inherits these)

CampBrain is **NOT a booking bot**. No agent may design or implement CAPTCHA bypass,
queue evasion, automated checkout, login automation, proxy rotation, or high-frequency
abusive scraping. Polling stays ≥60–120 min normally (15–30 min near a target date).
TypeScript strict, no `any`. See [CLAUDE.md](CLAUDE.md) for full conventions.
