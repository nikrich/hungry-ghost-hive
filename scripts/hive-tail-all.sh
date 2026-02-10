#!/usr/bin/env bash
set -euo pipefail

# Consolidate live output from all hive-* tmux sessions into one log, then tail it.
# Usage:
#   scripts/hive-tail-all.sh [optional-log-path]
#   scripts/hive-tail-all.sh --stop

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is not installed or not in PATH."
  exit 1
fi

mapfile -t sessions < <(tmux list-sessions -F '#S' 2>/dev/null | grep '^hive-' || true)

if [[ "${1:-}" == "--stop" ]]; then
  if ((${#sessions[@]} == 0)); then
    echo "No hive-* tmux sessions found."
    exit 0
  fi

  for session in "${sessions[@]}"; do
    tmux pipe-pane -t "$session"
  done

  echo "Disabled tmux pipe-pane for ${#sessions[@]} hive session(s)."
  exit 0
fi

if ((${#sessions[@]} == 0)); then
  echo "No hive-* tmux sessions found."
  exit 1
fi

log_file="${1:-$PWD/.hive/agents-combined.log}"
mkdir -p "$(dirname "$log_file")"
touch "$log_file"
log_file_escaped="$(printf '%q' "$log_file")"

for session in "${sessions[@]}"; do
  tmux pipe-pane -o -t "$session" \
    "stdbuf -oL awk '{ print strftime(\"%Y-%m-%d %H:%M:%S\"), \"[$session]\", \$0; fflush(); }' >> $log_file_escaped"
done

echo "Streaming ${#sessions[@]} hive session(s) into:"
echo "  $log_file"
echo
echo "Sessions:"
for session in "${sessions[@]}"; do
  echo "  - $session"
done
echo
echo "Press Ctrl+C to stop tailing (pipe forwarding keeps running)."
echo "Run 'scripts/hive-tail-all.sh --stop' to disable forwarding."
echo

tail -n 200 -F "$log_file"
