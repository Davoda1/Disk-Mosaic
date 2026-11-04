#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/_common.sh"
NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"
[[ -n "$NODE_BIN" ]] || fail "Node.js is required for source validation."
export NODE_BIN NPM_BIN
for file in "$ROOT"/scripts/*.sh; do bash -n "$file"; done
"$NODE_BIN" "$SCRIPT_DIR/validate-metadata.cjs"
run_node_test_suite
log "Source validation PASS. Native Rust tests and binary checks run through scripts/build.sh."
