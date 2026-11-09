#!/usr/bin/env bash
# Code Buddy: on commit, updates the teacher-style docs in docs/ to match your staged code.
# Runs automatically from the pre-commit hook, or manually via: bun run explain
# Skip once (PowerShell):  $env:SKIP_BUDDY=1; git commit -m "..."; Remove-Item Env:SKIP_BUDDY

set -euo pipefail

[ "${SKIP_BUDDY:-0}" = "1" ] && exit 0

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
PROMPT_FILE="scripts/teacher-prompt.md"

# Staged diff, ignoring noise, the docs themselves, and the buddy tooling
DIFF="$(git diff --cached -M -- . \
  ':!bun.lock' ':!*.lock' ':!docs/**' \
  ':!scripts/explain-staged.sh' ':!scripts/teacher-prompt.md' \
  ':!.githooks/**' ':!.claude/**' || true)"

BOOTSTRAP=0
[ -f docs/README.md ] || BOOTSTRAP=1

if [ -z "$DIFF" ] && [ "$BOOTSTRAP" = "0" ]; then
  exit 0
fi
[ -z "$DIFF" ] && DIFF="(no source changes — docs/README.md is missing, so document the whole project from scratch)"

if ! command -v claude >/dev/null 2>&1; then
  echo "[code-buddy] 'claude' CLI not found — skipping docs update."
  exit 0
fi

DIFF="$(printf '%s' "$DIFF" | head -c 60000)"

echo "[code-buddy] Updating docs/ for this commit... (set SKIP_BUDDY=1 to skip)"

INPUT="$(cat "$PROMPT_FILE")

### Project files
$(git ls-files --cached --others --exclude-standard | grep -v -E '^(node_modules/|bun.lock)')

### Existing docs
$(find docs -type f -name '*.md' 2>/dev/null | sort || true)

### Staged diff
\`\`\`diff
$DIFF
\`\`\`"

# Claude may read anything but may only write inside docs/
if printf '%s' "$INPUT" | claude -p \
     --allowedTools "Read" "Glob" "Grep" "Edit(docs/**)" "Bash(rm docs/*)" "Bash(mkdir -p docs/*)" "Bash(mv docs/*)"; then
  git add -A docs
  echo "[code-buddy] ✅ docs/ updated and added to this commit."
else
  echo "[code-buddy] Couldn't update docs — commit continues anyway."
fi
exit 0
