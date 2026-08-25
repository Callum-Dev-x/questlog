#!/bin/bash
# Publish questlog to GitHub Pages.
#
#   ./tools/deploy.sh ["commit message"]
#
# Bumps the service worker's cache version so installed copies pick the update
# up, commits anything outstanding, and pushes to origin/main.

set -euo pipefail
cd "$(dirname "$0")/.."

remote=$(git remote get-url origin 2>/dev/null || true)
if [ -z "$remote" ]; then
  echo "No 'origin' remote. Add one first:" >&2
  echo "  git remote add origin https://github.com/<you>/questlog.git" >&2
  exit 1
fi

# An installed app keeps serving its cached copy until the worker's version
# changes, so stamp a new one on every deploy.
stamp=$(date +%Y%m%d-%H%M)
if command -v sed >/dev/null; then
  sed -i '' -E "s/^const VERSION = '[^']*';/const VERSION = 'questlog-${stamp}';/" sw.js
  echo "service worker version: questlog-${stamp}"
fi

git add -A
if git diff --cached --quiet; then
  echo "nothing new to commit"
else
  git commit -q -m "${1:-update questlog ($stamp)}"
  echo "committed: ${1:-update questlog ($stamp)}"
fi

branch=$(git rev-parse --abbrev-ref HEAD)
git push -u origin "$branch"

user=$(printf '%s' "$remote" | sed -E 's#.*[:/]([^/]+)/[^/]+(\.git)?$#\1#' | tr '[:upper:]' '[:lower:]')
repo=$(printf '%s' "$remote" | sed -E 's#.*/([^/]+)(\.git)$#\1#')
echo
echo "Pushed. GitHub Pages will serve it at:"
echo "  https://${user}.github.io/${repo}/"
echo "(first deploy only: enable Settings -> Pages -> Deploy from a branch -> ${branch} / root)"
