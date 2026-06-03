---
name: doc-steward
description: Use to reconcile CampBrain documentation with shipped code — run after a feature ships or when CLAUDE.md, AGENTS.md, specs, or goal docs feel stale. Dispatches the doc-steward agent for a full knowledge-base pass.
---

# Documentation Steward (on-demand)

Run a full documentation reconciliation pass for CampBrain.

## What to do

Spawn the **doc-steward** agent (`.claude/agents/doc-steward.md`) with the Agent tool.
Give it:

1. The recent git history and working-tree diff to reconcile against:
   `git log --oneline -15` and `git diff --stat HEAD`.
2. The instruction to reconcile, in this order:
   - **CLAUDE.md** — Current State, Commands, Site Filters, and especially the
     **Next Steps** checklist (`[ ]` → `[~]` → `[x]`).
   - **AGENTS.md** — roster matches the actual `.claude/agents/*.md` files.
   - **Specs** — every shipped non-trivial feature has one in `docs/superpowers/specs/`;
     flag any that don't.
   - **Goal docs** in `docs/*-goal.md` — mark completed; keep history.

## Rules

- Verify before asserting: if a doc names a file/function/command/flag, confirm it still
  exists before keeping the claim.
- Docs only — never change production code.
- Do not document aspirational behavior as if implemented.
- Return a short report of edits made plus anything flagged-but-not-changed (e.g. a
  shipped feature missing a spec) for human follow-up.

For a large multi-file reconciliation, run the agent on Opus.
