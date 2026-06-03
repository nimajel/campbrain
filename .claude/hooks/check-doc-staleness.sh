#!/usr/bin/env bash
# Lightweight doc-staleness check for CampBrain (Stop hook).
# Advisory only: if uncommitted changes touch source code but no docs were updated,
# remind to run the doc-steward. Never blocks.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}"

# All changed paths (staged + unstaged + untracked), tracked-vs-working.
changed="$(git status --porcelain 2>/dev/null | awk '{print $2}')" || exit 0
[ -z "$changed" ] && exit 0

code_changed=false
docs_changed=false

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    test/*|*.test.ts) ;;                                   # tests don't require doc updates
    src/*|web/*) code_changed=true ;;
    CLAUDE.md|AGENTS.md|docs/*) docs_changed=true ;;
  esac
done <<< "$changed"

if [ "$code_changed" = true ] && [ "$docs_changed" = false ]; then
  echo "📝 doc-steward reminder: source changed but no docs (CLAUDE.md / AGENTS.md / docs/) were updated. Consider running the /doc-steward skill before committing."
fi

exit 0
