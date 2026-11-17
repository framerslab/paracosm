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
# It then runs the workflow's "Deploy to Linode" step itself, with stand-in
# rsync and ssh commands on PATH, and fails when:
#   - the step runs rsync while APP_DIR is empty, unset, a bare slash, relative
#     or holds a . or .. part: with --delete, a copy into the host's / removes
#     everything the build does not hold;
#   - for an accepted APP_DIR, the rsync destination or the directory the
#     remote script changes into is not that APP_DIR;
#   - the remote script changes APP_DIR in the host's environment: the server
#     pm2 starts reads APP_DIR for where it keeps its state.
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
if [ "$failed" -eq 0 ]; then
  echo "The deploy keeps all ${#host_data[@]} kinds of host data and removes all ${#stale_build[@]} stale build files."
fi

# The "Deploy to Linode" step's run block, its indentation removed and each
# ${{ env.NAME }} or ${{ secrets.NAME }} turned into the shell's ${NAME}.
step_text=$(awk '
  /^[[:space:]]*- name: Deploy to Linode[[:space:]]*$/ { found = 1; next }
  found && !on && /^[[:space:]]*run: \|[[:space:]]*$/ {
    match($0, /^[[:space:]]*/); run_indent = RLENGTH; on = 1; next
  }
  on {
    if ($0 ~ /^[[:space:]]*$/) { print ""; next }
    match($0, /^[[:space:]]*/)
    if (RLENGTH <= run_indent) exit
    if (!body_indent) body_indent = RLENGTH
    print substr($0, body_indent + 1)
  }
' "$workflow" | sed -E 's/\$\{\{ *(env|secrets)\.([A-Za-z_][A-Za-z0-9_]*) *\}\}/${\2}/g')
if [ -z "$step_text" ]; then
  echo "::error file=$workflow::No 'Deploy to Linode' step with a run block found in $workflow."
  exit 1
fi
if grep -q '\${{' <<<"$step_text"; then
  echo "::error file=$workflow::The 'Deploy to Linode' step holds an expression this check cannot stand in for."
  exit 1
fi
printf '%s\n' "$step_text" >"$work/deploy-step.sh"

stub_bin="$work/stub-bin"
mkdir -p "$stub_bin"
cat >"$stub_bin/rsync" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$STUB_LOG/rsync.args"
STUB
cat >"$stub_bin/ssh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$STUB_LOG/ssh.args"
cat >"$STUB_LOG/ssh.stdin"
STUB
chmod +x "$stub_bin/rsync" "$stub_bin/ssh"
server_ip=203.0.113.10
host_app_dir=/srv/paracosm-host-state

# Runs the step as GitHub runs a run block (bash -e) with APP_DIR set to $2,
# or unset when $2 is the word UNSET; the stubs log into $1.
run_deploy_step() {
  local log="$1" app_dir="$2"
  mkdir -p "$log/home"
  local vars=(PATH="$stub_bin:$PATH" HOME="$log/home" STUB_LOG="$log" SERVER_IP="$server_ip")
  if [ "$app_dir" != UNSET ]; then
    vars+=(APP_DIR="$app_dir")
  fi
  (cd "$log" && env -i "${vars[@]}" bash -e "$work/deploy-step.sh") >"$log/output" 2>&1
}

case_number=0
for app_dir in UNSET '' '/' '//' 'opt/paracosm' './opt/paracosm' '/opt/paracosm/..' '/opt/../'; do
  case_number=$((case_number + 1))
  log="$work/refuse-$case_number"
  status=0
  run_deploy_step "$log" "$app_dir" || status=$?
  if [ -e "$log/rsync.args" ]; then
    echo "::error file=$workflow::The deploy step runs rsync with APP_DIR='$app_dir' (destination: $(tail -n 1 "$log/rsync.args"))."
    failed=1
  elif [ "$status" -eq 0 ]; then
    echo "::error file=$workflow::The deploy step exits 0 with APP_DIR='$app_dir' instead of refusing it."
    failed=1
  fi
done

for app_dir in /srv/paracosm-check /srv/paracosm-check/; do
  case_number=$((case_number + 1))
  log="$work/accept-$case_number"
  expected="${app_dir%/}"
  status=0
  run_deploy_step "$log" "$app_dir" || status=$?
  if [ "$status" -ne 0 ]; then
    echo "::error file=$workflow::The deploy step fails with APP_DIR='$app_dir':"
    sed 's/^/  /' "$log/output"
    failed=1
    continue
  fi
  destination=$(tail -n 1 "$log/rsync.args" 2>/dev/null || true)
  if [ "$destination" != "root@$server_ip:$expected/" ]; then
    echo "::error file=$workflow::With APP_DIR='$app_dir' the rsync destination is '$destination', not 'root@$server_ip:$expected/'."
    failed=1
  fi
  if [ ! -e "$log/ssh.stdin" ]; then
    echo "::error file=$workflow::With APP_DIR='$app_dir' the deploy step never sends the remote script."
    failed=1
    continue
  fi
  # The remote script, run up to its first cd, which records its argument
  # and the APP_DIR its children would get, and stops the script there. The
  # host's shell starts with APP_DIR set to another directory, as a host
  # that keeps the server's state elsewhere would have it.
  { printf 'cd() { printf "%%s\\n" "$1" >"%s"; printenv APP_DIR >"%s" || :; exit 0; }\n' \
      "$log/remote-cd" "$log/remote-app-dir"
    cat "$log/ssh.stdin"; } | env -i PATH="$PATH" APP_DIR="$host_app_dir" bash -s >"$log/remote-output" 2>&1 || true
  remote_dir=$(cat "$log/remote-cd" 2>/dev/null || true)
  if [ "$remote_dir" != "$expected" ]; then
    echo "::error file=$workflow::With APP_DIR='$app_dir' rsync copies into $expected but the remote script changes into '$remote_dir'."
    failed=1
  fi
  remote_app_dir=$(cat "$log/remote-app-dir" 2>/dev/null || true)
  if [ "$remote_app_dir" != "$host_app_dir" ]; then
    echo "::error file=$workflow::With APP_DIR='$app_dir' the remote script sets the host's APP_DIR to '$remote_app_dir' in place of '$host_app_dir', and the server it starts reads APP_DIR for its state."
    failed=1
  fi
done

# Run the captured remote body on this disposable CI host. Only npm, pm2 and
# sleep are stand-ins; user creation and file ownership use the real tools.
remote_script="$log/ssh.stdin"
remote_bin="$work/remote-bin"
mkdir -p "$remote_bin"
chmod 755 "$work"
cat >"$remote_bin/npm" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$REMOTE_DIR/npm.calls"
if [ "$1" = ci ]; then
  count=$(grep -c '^ci ' "$REMOTE_DIR/npm.calls")
  case "$INSTALL_CASE" in
    always-fails) echo 'locked install failed' >&2; exit 1 ;;
    retry) if [ "$count" = 1 ]; then echo 'first locked install failed' >&2; exit 1; fi ;;
  esac
fi
STUB
cat >"$remote_bin/pm2" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$REMOTE_DIR/pm2.calls"
if [ "$1" = start ]; then
  printf '%s\n' "${PARACOSM_CLIENT_IP_HEADER:-}" "${PARACOSM_ALLOWED_ORIGINS:-}" >"$REMOTE_DIR/pm2.env"
fi
STUB
cat >"$remote_bin/sleep" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$REMOTE_DIR/sleep.calls"
STUB
chmod +x "$remote_bin/"*

check_remote() {
  local name="$1"
  shift
  if ! "$@"; then
    echo "::error::$name"
    failed=1
  fi
}

for install_case in always-fails retry success; do
  remote_dir="$work/remote-$install_case"
  mkdir -p "$remote_dir/src" "$remote_dir/node_modules" "$remote_dir/dist/cli"
  printf 'PRIVATE_SETTING=test-value\n' >"$remote_dir/.env"
  chmod 600 "$remote_dir/.env"
  writable_dirs=(data output .live-runs scenarios/compiled .paracosm)
  writable_files=(.rate-limit.json .rate-limit.json.tmp .retry-stats.json .event-buffer.json)
  # Both first-deploy (absent) and existing state must be writable on start.
  if [ "$install_case" != retry ]; then
    for path in "${writable_dirs[@]}"; do
      mkdir -p "$remote_dir/$path"
      echo saved >"$remote_dir/$path/saved"
    done
    for path in "${writable_files[@]}"; do echo '{}' >"$remote_dir/$path"; done
  fi
  { printf "deploy_dir='%s'\n" "$remote_dir"; tail -n +2 "$remote_script"; } >"$remote_dir/remote.sh"
  status=0
  env PATH="$remote_bin:$PATH" REMOTE_DIR="$remote_dir" INSTALL_CASE="$install_case" \
    bash -e "$remote_dir/remote.sh" >"$remote_dir/output" 2>&1 || status=$?
  calls=$(cat "$remote_dir/npm.calls" 2>/dev/null || true)
  pm2_calls=$(cat "$remote_dir/pm2.calls" 2>/dev/null || true)
  check_remote 'the remote script installs only from the lockfile: flags and command' \
    test -z "$(printf '%s\n' "$calls" | grep -v '^ci --omit=dev --no-audit --no-fund$' || true)"
  if [ "$install_case" = always-fails ]; then
    check_remote 'the remote script installs only from the lockfile: second failure stops' test "$status" -ne 0
    check_remote 'the remote script installs only from the lockfile: no restart after failure' test -z "$pm2_calls"
    check_remote 'the remote script installs only from the lockfile: error remains visible' \
      grep -q 'locked install failed' "$remote_dir/output"
  else
    check_remote 'the remote script starts after a locked install succeeds' test "$status" -eq 0
    if [ "$status" -ne 0 ]; then cat "$remote_dir/output"; fi
    check_remote 'the deploy starts the server from built files' \
      grep -q '^start dist/cli/serve.js ' "$remote_dir/pm2.calls"
    check_remote 'the deploy starts the server as the service user: uid and gid' \
      grep -q -- '--uid paracosm --gid paracosm' "$remote_dir/pm2.calls"
    check_remote 'the deploy limits server memory to 1200M' \
      grep -q -- '--max-memory-restart 1200M' "$remote_dir/pm2.calls"
    check_remote 'the deploy keeps the client IP and allowed origin settings' \
      test "$(cat "$remote_dir/pm2.env" 2>/dev/null)" = $'cf-connecting-ip\nhttps://paracosm.agentos.sh'
    for path in "${writable_dirs[@]}" "${writable_files[@]}"; do
      check_remote "the deploy starts the server as the service user: owns $path" \
        test "$(stat -c '%U:%G' "$remote_dir/$path" 2>/dev/null || true)" = paracosm:paracosm
      check_remote "the service user can write $path" runuser -u paracosm -- test -w "$remote_dir/$path"
    done
    if [ "$install_case" = success ]; then
      for path in "${writable_dirs[@]}"; do
        check_remote "existing state in $path remains and belongs to the service user" \
          test "$(stat -c '%U:%G' "$remote_dir/$path/saved")" = paracosm:paracosm
      done
    fi
    for path in src node_modules dist; do
      check_remote "the service user does not own $path" \
        test "$(stat -c '%U' "$remote_dir/$path")" = root
      check_remote "the service user cannot write $path" \
        runuser -u paracosm -- test ! -w "$remote_dir/$path"
    done
    check_remote 'the service user reads the existing .env keys' \
      runuser -u paracosm -- grep -q '^PRIVATE_SETTING=test-value$' "$remote_dir/.env"
    check_remote '.env stays private to root and the service group' \
      test "$(stat -c '%U:%G:%a' "$remote_dir/.env")" = root:paracosm:640
    check_remote 'other users cannot read .env' runuser -u nobody -- test ! -r "$remote_dir/.env"
  fi
  expected_calls=2
  if [ "$install_case" = success ]; then expected_calls=1; fi
  check_remote 'the remote script installs only from the lockfile: at most one retry' \
    test "$(grep -c '^ci ' "$remote_dir/npm.calls")" -eq "$expected_calls"
done
check_remote 'the remote script has no unlocked install command' \
  test -z "$(grep -E '\bnpm (install|i)( |$)' "$remote_script" || true)"

if [ "$failed" -ne 0 ]; then
  exit 1
fi
echo "The deploy step refuses $((case_number - 2)) unsafe APP_DIR values before rsync and copies into and starts from the same APP_DIR."
