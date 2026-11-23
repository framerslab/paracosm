#!/usr/bin/env bash
# Runs only against a disposable SSH server bound to loopback in CI.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work=$(mktemp -d)
sshd_pid=''
cleanup() {
  if [ -n "$sshd_pid" ]; then kill "$sshd_pid" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT
failed=0
if grep -R -n 'ssh-keyscan' "$root/.github/workflows"; then
  echo '::error::the deploy uses only the configured host key'
  failed=1
fi
awk '
  /^      - name: Setup SSH$/ { found = 1; next }
  found && /^        run: \|$/ { on = 1; next }
  on && /^          / { print substr($0, 11); next }
  on && /^$/ { print ""; next }
  on { exit }
' "$root/.github/workflows/deploy.yml" | sed -E \
  's/\$\{\{ *(env|secrets)\.([A-Za-z_][A-Za-z0-9_]*) *\}\}/${\2}/g' >"$work/setup.sh"
# Refuse the previous setup before it could contact any address.
if grep -q 'ssh-keyscan' "$work/setup.sh"; then
  echo '::error::the deploy pins the host key before connecting'
  exit 1
fi
mkdir -p "$work/home/.ssh" /run/sshd
chmod 700 "$work/home/.ssh"
for name in host other client; do ssh-keygen -q -t ed25519 -N '' -f "$work/$name"; done
cp "$work/client.pub" "$work/authorized_keys"
cat >"$work/sshd_config" <<CONFIG
ListenAddress 127.0.0.1
Port 22222
HostKey $work/host
PidFile $work/sshd.pid
AuthorizedKeysFile $work/authorized_keys
StrictModes no
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
LogLevel VERBOSE
CONFIG
/usr/sbin/sshd -D -e -f "$work/sshd_config" >"$work/sshd.log" 2>&1 &
sshd_pid=$!
for attempt in $(seq 1 50); do
  if grep -q 'Server listening' "$work/sshd.log"; then break; fi
  sleep 0.1
done
grep -q 'Server listening' "$work/sshd.log"
setup() {
  HOME="$work/home" SERVER_IP='[127.0.0.1]:22222' SERVER_HOST_KEY="$1" \
    DEPLOY_SSH_KEY="$(cat "$work/client")" bash -e "$work/setup.sh"
}
connect() {
  # OpenSSH resolves ~ against the account, not HOME; relocate only that
  # literal in the generated config, and retain all of its checking options.
  sed "s|~/.ssh/|$work/home/.ssh/|g" "$work/home/.ssh/config" >"$work/client_config"
  ssh -F "$work/client_config" -o BatchMode=yes -o ConnectTimeout=5 \
    -o GlobalKnownHostsFile=/dev/null -p 22222 -i "$work/home/.ssh/deploy_key" root@127.0.0.1 true
}
setup "$(cut -d ' ' -f 1,2 "$work/other.pub")"
if connect >"$work/wrong-key.log" 2>&1; then
  echo '::error::the deploy refuses a different host key'; failed=1
elif ! grep -q 'Host key verification failed' "$work/wrong-key.log"; then
  cat "$work/wrong-key.log"; failed=1
fi
setup "$(cut -d ' ' -f 1,2 "$work/host.pub")"
if ! connect >"$work/right-key.log" 2>&1; then
  cat "$work/right-key.log"; failed=1
fi
if [ "$(wc -l <"$work/home/.ssh/known_hosts")" -ne 1 ]; then
  echo '::error::the deploy writes exactly one pinned host entry'; failed=1
fi
if setup '' >"$work/empty-key.log" 2>&1; then
  echo '::error::the deploy requires a nonempty host key'; failed=1
fi
if [ "$failed" -ne 0 ]; then exit 1; fi
echo 'The deploy pins the host key: a different or empty key fails, the matching key connects.'
