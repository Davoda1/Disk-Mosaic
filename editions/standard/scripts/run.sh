#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

latest_arg=()
case "${1:-}" in
  "") ;;
  -l|--latest) latest_arg=("--latest"); shift ;;
  *) printf 'ERROR: Usage: run.sh [-l|--latest]\n' >&2; exit 1 ;;
esac
[[ $# -eq 0 ]] || { printf 'ERROR: Usage: run.sh [-l|--latest]\n' >&2; exit 1; }

"$SCRIPT_DIR/build.sh" "${latest_arg[@]}"
"$SCRIPT_DIR/package.sh" "${latest_arg[@]}"
printf '%s\n' "DiskMosaic 1.0.1 all-in-one build + package PASS. Nothing was launched."
