#!/usr/bin/env bash
# Prints `true` when the npm package must publish, else `false`: true when a
# file the package ships or builds from changed since the last release tag, or
# when HEAD's history has no release tag. Run it from the repository root with
# the tags fetched (actions/checkout with fetch-depth: 0). Diagnostics go to
# standard error.
#
# The release tag is the newest v<major>.<minor>.<patch> on HEAD's history
# without a pre-release suffix (v1.0.0-rc.1 is not one). Only the deploy
# workflow's publish job makes them: a tag made by hand becomes the baseline
# and can hide changes that were never published. scripts/detect-library-change.mjs
# holds the rule for which paths ship.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
base=$(git describe --tags --abbrev=0 --match 'v[0-9]*' --exclude '*-*' HEAD 2>/dev/null || true)
if [ -z "$base" ]; then
  echo "No release tag on this commit's history." >&2
  echo true
  exit 0
fi
echo "Comparing with $base. Changed files:" >&2
git diff --name-only "$base" HEAD | tee /dev/stderr | node "$here/detect-library-change.mjs"
