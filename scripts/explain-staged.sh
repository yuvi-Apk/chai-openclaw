#!/usr/bin/env bash
# Code Buddy: explains your staged changes like a teacher and appends it to docs/LEARNING.md.
# Runs automatically from the pre-commit hook, or manually via: bun run explain
# Skip once with:  SKIP_BUDDY=1 git commit -m "..."

set -euo pipefail

[ "${SKIP_BUDDY:-0}" = "1" ] && exit 0

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
DOC="docs/LEARNING.md"
PROMPT_FILE="scripts/teacher-prompt.md"

# Staged diff, ignoring noise and the learning doc itself
DIFF="$(git diff --cached -- . ':!bun.lock' ':!docs/LEARNING.md' ':!*.lock' || true)"

if [ -z "$DIFF" ]; then
  exit 0
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "[code-buddy] 'claude' CLI not found — skipping explanation."
  exit 0
fi

# Keep very large diffs within reason
DIFF="$(printf '%s' "$DIFF" | head -c 60000)"

echo "[code-buddy] Writing your lesson for this change... (SKIP_BUDDY=1 to skip)"

INPUT="$(cat "$PROMPT_FILE")

### Project files
$(git ls-files --cached --others --exclude-standard | grep -v -E '^(node_modules/|bun.lock)' )

### Staged diff
\`\`\`diff
$DIFF
\`\`\`"

if ! LESSON="$(printf '%s' "$INPUT" | claude -p 2>/dev/null)" || [ -z "$LESSON" ]; then
  echo "[code-buddy] Couldn't generate an explanation — commit continues anyway."
  exit 0
fi

if [ ! -f "$DOC" ]; then
  mkdir -p docs
  cat > "$DOC" <<'EOF'
# 📚 chai-openclaw — Learning Journal

This file is written automatically by **Code Buddy** every time you commit.
Each entry explains *what* you built, *why* it exists, and *why* each tool/pattern is used —
like a teacher walking through your code. Newest entries are at the bottom.

EOF
fi

{
  printf '\n---\n\n'
  printf '<sub>🗓️ %s</sub>\n\n' "$(date '+%Y-%m-%d %H:%M')"
  printf '%s\n' "$LESSON"
} >> "$DOC"

git add "$DOC"
echo "[code-buddy] ✅ Lesson added to $DOC"
