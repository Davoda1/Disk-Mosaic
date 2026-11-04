#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

latest=0
case "${1:-}" in
  "") ;;
  -l|--latest) latest=1; shift ;;
  *) fail "Usage: build.sh [-l|--latest]" ;;
esac
[[ $# -eq 0 ]] || fail "Usage: build.sh [-l|--latest]"

preflight
prepare_node "$latest"
ensure_npm_dependencies
prepare_rust_workspace

log "Running Rust validation/tests from isolated staging workspace..."
run_rust_test_suite
audit_rust_licenses
build_engine_release
copy_engine_for_packaging

log "Running renderer/Electron security tests with high-detail diagnostics..."
run_node_test_suite
log "Build PASS. Engine staged under gui/resources/engine/. Nothing was launched."
