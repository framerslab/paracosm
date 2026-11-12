#!/usr/bin/env bash
# Checks that the deploy keeps the data the server writes on the host.
#
# The deploy job in .github/workflows/deploy.yml copies the build to the host
# with `rsync --delete`, which removes every host path the build does not hold
# unless a filter rule excludes it. This script reads that rsync command's
# --exclude and --filter options from the workflow, runs rsync with them and
# --delete from a stand-in build into a stand-in host tree, and fails when:
#   - a path the server writes on the host is gone afterwards: the scenarios
#     people compiled (scenarios/compiled/), the compiler's hook cache
#     (.paracosm/), finished runs held for their visitors (.live-runs/), the
#     rate-limit and retry-stats files, the SQLite files (data/), run output
#     (output/), logs and the hand-written .env;
#   - a file the build owns and no longer ships is still there afterwards (a
#     removed bundle, a removed bundled scenario): a rule that protects too
#     much leaves stale build files behind;
#   - a file the build ships does not replace the host's earlier copy;
#   - the command uses --delete-excluded, which deletes excluded paths too.
#
# Usage: bash scripts/check-deploy-keeps-host-data.sh [path/to/deploy.yml]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workflow="${1:-$root/.github/workflows/deploy.yml}"

# The rsync command: from the line that starts it to the `-e` line.
command_text=$(awk '
  /^[[:space:]]*rsync .*--delete/ { on = 1 }
  on { print }
  on && /^[[:space:]]*-e / { exit }
' "$workflow")
if [ -z "$command_text" ]; then
  echo "::error file=$workflow::No 'rsync ... --delete' command found in $workflow."
  exit 1
fi
if grep -q -- '--delete-excluded' <<<"$command_text"; then
  echo "::error file=$workflow::The deploy rsync uses --delete-excluded, which deletes the excluded host data."
  exit 1
fi

# Its filter options, one per line, quotes removed.
rules=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%\\}"
  line="${line%"${line##*[![:space:]]}"}"
  case "$line" in
    --exclude=*|--filter=*|--include=*)
      line="${line//\'/}"
      line="${line//\"/}"
      rules+=("$line")
      ;;
  esac
done <<<"$command_text"
if [ "${#rules[@]}" -eq 0 ]; then
  echo "::error file=$workflow::The deploy rsync has no --exclude or --filter option."
  exit 1
fi
echo "Filter options read from $workflow:"
printf '  %s\n' "${rules[@]}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
build="$work/build"
host="$work/host"
scenario="$root/scenarios/mars.json"

# The build: what the artifact holds.
mkdir -p "$build/dist" "$build/scenarios" "$build/docs/api"
echo 'export {};' >"$build/dist/index.js"
cp "$scenario" "$build/scenarios/mars.json"
echo '<html></html>' >"$build/docs/api/index.html"

# The host after an earlier deploy and some use.
host_data=(
  "scenarios/compiled/planted-compiled.json"
  ".paracosm/cache/planted-compiled-v1.0.0/manifest.json"
  ".live-runs/planted-run.json"
  ".rate-limit.json"
  ".rate-limit.json.tmp"
  ".retry-stats.json"
  ".event-buffer.json"
  "data/sessions.db"
  "data/runs.db"
  "output/v3-planted.json"
  "logs/paracosm.log"
  ".env"
  "node_modules/planted/package.json"
)
stale_build=(
  "dist/removed-bundle.js"
  "scenarios/removed-bundled.json"
  "docs/api/removed-page.html"
)
# The earlier deploy's copies of two build files differ from the new build's,
# so the copy check below sees the build replace them.
mkdir -p "$host/dist" "$host/scenarios" "$host/docs/api"
echo 'export const previous = true;' >"$host/dist/index.js"
cp "$root/scenarios/lunar.json" "$host/scenarios/mars.json"
for path in "${host_data[@]}" "${stale_build[@]}"; do
  mkdir -p "$(dirname "$host/$path")"
  case "$path" in
    *.json) cp "$scenario" "$host/$path" ;;
    *) echo planted >"$host/$path" ;;
  esac
done

rsync -a --delete "${rules[@]}" "$build/" "$host/"

failed=0
for path in "${host_data[@]}"; do
  if [ ! -e "$host/$path" ]; then
    echo "::error file=$workflow::A deploy deletes host data: $path"
    failed=1
  fi
done
for path in "${stale_build[@]}"; do
  if [ -e "$host/$path" ]; then
    echo "::error file=$workflow::A deploy leaves a stale build file behind: $path"
    failed=1
  fi
done
for path in dist/index.js scenarios/mars.json docs/api/index.html; do
  if ! cmp -s "$build/$path" "$host/$path"; then
    echo "::error file=$workflow::A deploy does not copy the build file $path"
    failed=1
  fi
done
if [ "$failed" -ne 0 ]; then
  exit 1
fi
echo "The deploy keeps all ${#host_data[@]} kinds of host data and removes all ${#stale_build[@]} stale build files."
