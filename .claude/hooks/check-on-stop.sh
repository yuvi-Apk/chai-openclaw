#!/usr/bin/env bash
# Stop hook: before Claude finishes, run tests and the type check if any
# TypeScript file changed. Exit 2 sends the failure back to Claude to fix.
input="$(cat)"

# Already re-running after a failed check: let it stop, to avoid a loop.
if echo "$input" | grep -q '"stop_hook_active": *true'; then
    exit 0
fi

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 0

# Nothing to check unless a .ts file is modified or new.
if ! git status --porcelain --untracked-files=all | grep -qE '\.ts"?$'; then
    exit 0
fi

if ! test_out="$(bun test 2>&1)"; then
    echo "bun test failed. Fix before finishing:" >&2
    echo "$test_out" | tail -n 30 >&2
    exit 2
fi

if ! tsc_out="$(bunx tsc --noEmit -p . 2>&1)"; then
    echo "Type check failed. Fix before finishing:" >&2
    echo "$tsc_out" | tail -n 30 >&2
    exit 2
fi

exit 0
