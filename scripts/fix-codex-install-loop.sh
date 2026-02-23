#!/usr/bin/env bash
set -euo pipefail

# Remove conflicting Codex CLI installs while preserving nvm-managed install.
# Dry-run by default. Pass --apply to execute.

APPLY=0
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=1
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--apply]"
  exit 1
fi

run() {
  if [[ $APPLY -eq 1 ]]; then
    "$@"
  else
    printf '[dry-run] '
    printf '%q ' "$@"
    printf '\n'
  fi
}

remove_path() {
  local path="$1"
  [[ -e "$path" ]] || return 0

  if [[ -w "$(dirname "$path")" ]]; then
    run rm -rf -- "$path"
  else
    echo "Skipping (requires elevated permissions): $path"
    echo "Run manually: sudo rm -rf -- '$path'"
  fi
}

mapfile -t CODEX_PATHS < <(which -a codex 2>/dev/null | awk '!seen[$0]++')
if [[ ${#CODEX_PATHS[@]} -eq 0 ]]; then
  echo "No codex binaries found on PATH."
  exit 1
fi

KEEP_PATH=""
for p in "${CODEX_PATHS[@]}"; do
  if [[ "$p" == "$HOME/.nvm/versions/node/"*/bin/codex ]]; then
    KEEP_PATH="$p"
    break
  fi
done

if [[ -z "$KEEP_PATH" ]]; then
  echo "Could not find nvm-managed codex to keep."
  printf 'Found: %s\n' "${CODEX_PATHS[@]}"
  exit 1
fi

echo "Keeping: $KEEP_PATH"
echo "Removing conflicting installs:"

for p in "${CODEX_PATHS[@]}"; do
  [[ "$p" == "$KEEP_PATH" ]] && continue
  echo "  - $p"

  case "$p" in
    "$HOME/.npm-global/bin/codex")
      remove_path "$HOME/.npm-global/bin/codex"
      remove_path "$HOME/.npm-global/lib/node_modules/@openai/codex"
      ;;
    /usr/local/bin/codex)
      remove_path "/usr/local/bin/codex"
      remove_path "/usr/local/lib/node_modules/@openai/codex"
      ;;
    /mnt/c/Users/*/AppData/Roaming/npm/codex)
      local_dir="$(dirname "$p")"
      remove_path "$local_dir/codex"
      remove_path "$local_dir/codex.cmd"
      remove_path "$local_dir/codex.ps1"
      remove_path "$local_dir/node_modules/@openai/codex"
      ;;
    *)
      remove_path "$p"
      ;;
  esac
done

echo
if [[ $APPLY -eq 0 ]]; then
  echo "Dry run complete. Re-run with --apply to execute removals."
fi

echo "Then run:"
echo "  exec bash -l"
echo "  which -a codex"
echo "  codex --version"
