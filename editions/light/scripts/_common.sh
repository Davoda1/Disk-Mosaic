#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
GUI_DIR="$ROOT/gui"
ENGINE_DIR="$ROOT/engine"
ENGINE_MANIFEST="$ENGINE_DIR/Cargo.toml"
DEPS_DIR="$ROOT/dependencies"
TOOLINGS_DIR="$ROOT/toolings"
NODE_POINTER="$TOOLINGS_DIR/node-current.txt"
RUST_WORK_ROOT="$DEPS_DIR/rust-work"
RUST_ENGINE_DIR="$RUST_WORK_ROOT/engine"
RUST_ENGINE_MANIFEST="$RUST_ENGINE_DIR/Cargo.toml"
CARGO_TARGET_DIR="$DEPS_DIR/cargo-target"

log() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

preflight() {
  [[ "$(uname -m)" == "x86_64" ]] || fail "DiskMosaic build scripts currently target x86-64; detected $(uname -m)."
  command -v rustc >/dev/null 2>&1 || fail "rustc was not found. Install the stable Rust toolchain, then rerun. This script will not modify your Rust installation."
  command -v cargo >/dev/null 2>&1 || fail "cargo was not found. Install the stable Rust toolchain, then rerun."
  command -v curl >/dev/null 2>&1 || fail "curl is required to obtain the project-local Node.js LTS runtime."
  command -v tar >/dev/null 2>&1 || fail "tar is required to unpack the project-local Node.js runtime."
  command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required to verify project-local downloads and release artifacts."

  mkdir -p \
    "$DEPS_DIR/cargo-home" \
    "$DEPS_DIR/npm-cache" \
    "$DEPS_DIR/electron-cache" \
    "$DEPS_DIR/tmp" \
    "$CARGO_TARGET_DIR" \
    "$RUST_WORK_ROOT" \
    "$TOOLINGS_DIR" \
    "$ROOT/dist"

  # Keep all Cargo state produced by these scripts inside the project. We use the
  # already-installed rustc/cargo binaries but never call rustup or edit user/global
  # Cargo configuration, shell profiles, PATH, or Rust configuration files.
  export CARGO_HOME="$DEPS_DIR/cargo-home"
  export CARGO_TARGET_DIR
  export TMPDIR="$DEPS_DIR/tmp"

  # Keep Node/Electron caches project-local as well.
  export npm_config_cache="$DEPS_DIR/npm-cache"
  export npm_config_audit=false
  export npm_config_fund=false
  export npm_config_package_lock=true
  export ELECTRON_CACHE="$DEPS_DIR/electron-cache"
  export electron_config_cache="$DEPS_DIR/electron-cache"

  local free_kb
  free_kb="$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')"
  if [[ "${free_kb:-0}" -lt 4194304 ]]; then
    fail "At least 4 GiB of free space is recommended for Electron/Rust build dependencies."
  fi
  log "Preflight PASS: $(rustc --version); $(cargo --version)"
  log "Rust build state is isolated under: $DEPS_DIR/cargo-home, $RUST_WORK_ROOT and $CARGO_TARGET_DIR"
}

cached_node_dir() {
  [[ -f "$NODE_POINTER" ]] || return 1
  local version
  version="$(tr -d '\r\n' < "$NODE_POINTER")"
  local dir="$TOOLINGS_DIR/node-$version-linux-x64"
  [[ -x "$dir/bin/node" ]] || return 1
  printf '%s\n' "$dir"
}

resolve_current_lts_version() {
  log "Resolving the current Node.js LTS release..." >&2
  local index_file="$TOOLINGS_DIR/node-index.json"
  if ! curl --fail --location --silent --show-error https://nodejs.org/dist/index.json -o "$index_file"; then
    fail "Could not download the Node.js release index. A network connection is required when project-local Node must be prepared or refreshed."
  fi
  local version
  version="$(grep -m1 '"lts"[[:space:]]*:[[:space:]]*"' "$index_file" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' | sed 's/^v//')"
  rm -f "$index_file"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Could not determine the current Node.js LTS version."
  printf '%s\n' "$version"
}

download_node() {
  local version="$1"
  local node_dir="$TOOLINGS_DIR/node-$version-linux-x64"
  if [[ ! -x "$node_dir/bin/node" ]]; then
    log "Downloading Node.js v$version LTS into toolings/..." >&2
    local archive_name="node-v$version-linux-x64.tar.xz"
    local archive="$TOOLINGS_DIR/$archive_name"
    local checksums="$TOOLINGS_DIR/node-v$version-SHASUMS256.txt"
    curl --fail --location --show-error "https://nodejs.org/dist/v$version/$archive_name" -o "$archive"
    curl --fail --location --show-error "https://nodejs.org/dist/v$version/SHASUMS256.txt" -o "$checksums"
    local expected actual
    expected="$(awk -v file="$archive_name" '$2 == file { print $1; exit }' "$checksums")"
    [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || fail "Could not find a SHA-256 entry for $archive_name."
    actual="$(sha256sum "$archive" | awk '{print $1}')"
    [[ "${actual,,}" == "${expected,,}" ]] || fail "Node.js SHA-256 verification failed for $archive_name."
    rm -f "$checksums"
    rm -rf "$node_dir" "$TOOLINGS_DIR/node-v$version-linux-x64"
    tar -xJf "$archive" -C "$TOOLINGS_DIR"
    mv "$TOOLINGS_DIR/node-v$version-linux-x64" "$node_dir"
    rm -f "$archive"
  fi
  printf '%s\n' "$node_dir"
}

use_latest_npm() {
  local latest_dir="$TOOLINGS_DIR/npm-latest"
  local latest_bin="$latest_dir/node_modules/.bin/npm"
  log "Latest mode: installing/updating npm@latest inside toolings/npm-latest/..."
  "$NPM_BIN" install --prefix "$latest_dir" --no-save --no-package-lock --no-audit --no-fund npm@latest
  [[ -x "$latest_bin" ]] || fail "npm@latest was installed but its project-local executable was not found."
  NPM_BIN="$latest_bin"
  export NPM_BIN
}

prepare_node() {
  local latest="${1:-0}"
  local node_dir=""
  local version=""

  # A preinstalled toolchain is the reproducible default (including CI). Explicit
  # --latest mode refreshes only project-local tooling, never system installations.
  if [[ "$latest" != "1" ]] && command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
    NPM_BIN="$(command -v npm)"
    "$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>26||(a===26&&b>=13)?0:1)' || fail "Node.js 26.13.0 LTS or newer is required."
    export NODE_BIN NPM_BIN
    log "Installed Node: $($NODE_BIN --version); npm: $($NPM_BIN --version)"
    return
  fi
  if [[ "$latest" != "1" ]]; then
    node_dir="$(cached_node_dir || true)"
    [[ -n "$node_dir" ]] || fail "Install Node.js 26.13.0 LTS or newer, or use --latest to download project-local tooling."
  fi

  if [[ -z "$node_dir" ]]; then
    version="$(resolve_current_lts_version)"
    node_dir="$(download_node "$version")"
    printf '%s\n' "$version" > "$NODE_POINTER"
  fi

  export PATH="$node_dir/bin:$PATH"
  NODE_BIN="$node_dir/bin/node"
  NPM_BIN="$node_dir/bin/npm"
  export NODE_BIN NPM_BIN
  "$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>26||(a===26&&b>=13)?0:1)' || fail "Cached Node.js is too old. Use --latest to prepare Node.js 26.13.0 LTS or newer."
  if [[ "$latest" == "1" ]]; then
    use_latest_npm
    log "Project-local Node: $($NODE_BIN --version); npm: $($NPM_BIN --version) (Latest mode)"
  else
    log "Project-local Node: $($NODE_BIN --version); npm: $($NPM_BIN --version)"
  fi
}

ensure_npm_dependencies() {
  [[ -f "$GUI_DIR/package-lock.json" ]] || fail "The committed gui/package-lock.json is required."
  local fingerprint recorded=""
  fingerprint="$("$NODE_BIN" "$SCRIPT_DIR/dependency-fingerprint.cjs" "$GUI_DIR")"
  local stamp="$GUI_DIR/node_modules/.diskmosaic-lock-fingerprint"
  [[ ! -f "$stamp" ]] || recorded="$(cat "$stamp")"
  if [[ "$recorded" != "$fingerprint" || ! -x "$GUI_DIR/node_modules/.bin/electron" || ! -x "$GUI_DIR/node_modules/.bin/electron-packager" ]]; then
    log "Installing locked project-local Electron dependencies..."
    (cd "$GUI_DIR" && "$NPM_BIN" ci --no-audit --no-fund)
    printf '%s\n' "$fingerprint" > "$stamp"
  fi
}


prepare_rust_workspace() {
  # Copy the committed lockfile into a disposable staging tree. --locked prevents
  # an ordinary build from silently changing the dependency graph.
  rm -rf "$RUST_WORK_ROOT"
  mkdir -p "$RUST_ENGINE_DIR/.cargo"
  [[ -f "$ENGINE_DIR/Cargo.lock" ]] || fail "The committed engine/Cargo.lock is required."
  cp "$ENGINE_MANIFEST" "$RUST_ENGINE_MANIFEST"
  cp "$ENGINE_DIR/Cargo.lock" "$RUST_ENGINE_DIR/Cargo.lock"
  cp -a "$ENGINE_DIR/src" "$RUST_ENGINE_DIR/src"
  cp -a "$ROOT/tests" "$RUST_WORK_ROOT/tests"

  # Release binaries must not disclose the builder's checkout/cache paths. Put the remap
  # rules only in the disposable staging workspace; no user/global Cargo config is touched.
  local cargo_home="${CARGO_HOME:-$DEPS_DIR/cargo-home}"
  local tmpdir="${TMPDIR:-$DEPS_DIR/tmp}"
  local config="$RUST_ENGINE_DIR/.cargo/config.toml"
  toml_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
  cat > "$config" <<EOF
[build]
rustflags = [
  "--remap-path-prefix=$(toml_escape "$RUST_ENGINE_DIR")=/usr/src/diskmosaic/engine",
  "--remap-path-prefix=$(toml_escape "$RUST_WORK_ROOT")=/usr/src/diskmosaic/rust-work",
  "--remap-path-prefix=$(toml_escape "$cargo_home")=/usr/src/cargo",
  "--remap-path-prefix=$(toml_escape "$CARGO_TARGET_DIR")=/usr/src/diskmosaic/target",
  "--remap-path-prefix=$(toml_escape "$tmpdir")=/tmp/diskmosaic",
  "--remap-path-prefix=$(toml_escape "$ROOT")=/usr/src/diskmosaic"
]
EOF
  log "Rust source/build paths will be remapped by disposable $config"
}

rust_diagnostic_context() {
  log "--- DiskMosaic Rust diagnostic context ---"
  log "Project root: $ROOT"
  log "Staged manifest: $RUST_ENGINE_MANIFEST"
  log "CARGO_HOME: ${CARGO_HOME:-}"
  log "CARGO_TARGET_DIR: ${CARGO_TARGET_DIR:-}"
  log "TMPDIR: ${TMPDIR:-}"
  log "Kernel: $(uname -a)"
  log "rustc verbose version:"
  rustc -vV || true
  log "cargo version:"
  cargo -V || true
  log "Staged Cargo.toml dependency lines:"
  grep -E '^(name|version|edition|blake3|notify|rusqlite|trash|windows-sys)[[:space:]]*=' "$RUST_ENGINE_MANIFEST" | sed 's/^/  /' || true
  log "--- End Rust diagnostic context ---"
}

run_rust_test_suite() {
  local old_backtrace="${RUST_BACKTRACE-__DISKMOSAIC_UNSET__}"
  export RUST_BACKTRACE=1
  rust_diagnostic_context

  log "[Rust 1/3] Compiling all test targets without running them..."
  if ! (cd "$RUST_ENGINE_DIR" && cargo test --locked --manifest-path "$RUST_ENGINE_MANIFEST" --no-run); then
    log "Rust test compilation FAILED before any tests executed."
    rust_diagnostic_context
    fail "Rust test compilation failed. The diagnostic context above is intended to be included with the full build log."
  fi

  if cargo fmt --version >/dev/null 2>&1; then
    log "[Rust 2/3] Checking Rust formatting in the disposable staging workspace..."
    if ! (cd "$RUST_ENGINE_DIR" && cargo fmt --manifest-path "$RUST_ENGINE_MANIFEST" --all -- --check); then
      log "WARNING: Rust formatting check reported differences. This is diagnostic-only and does not block compilation/tests."
    fi
  else
    log "[Rust 2/3] rustfmt is not installed; formatting check SKIPPED."
  fi

  log "[Rust 3/3] Running tests sequentially with captured output disabled and backtraces enabled..."
  if ! (cd "$RUST_ENGINE_DIR" && cargo test --locked --manifest-path "$RUST_ENGINE_MANIFEST" -- --nocapture --test-threads=1); then
    log "Rust test suite FAILED. Running focused diagnostic passes by subsystem..."
    local filter rc
    for filter in \
      'analysis::tests::' \
      'history::tests::' \
      'filetype::tests::' \
      'model::tests::' \
      'watcher::tests::' \
      'duplicates::tests::' \
      'snapshot::tests::' \
      'scanner::tests::'; do
      log "--- Focused Rust diagnostics: $filter ---"
      rc=0
      (cd "$RUST_ENGINE_DIR" && cargo test --locked --manifest-path "$RUST_ENGINE_MANIFEST" "$filter" -- --nocapture --test-threads=1) || rc=$?
      log "--- Focused result: $filter exit code $rc ---"
    done
    rust_diagnostic_context
    fail "Rust tests failed. The full log now includes sequential output, backtraces, environment details and focused subsystem reruns."
  fi

  if [[ "$old_backtrace" == "__DISKMOSAIC_UNSET__" ]]; then unset RUST_BACKTRACE; else export RUST_BACKTRACE="$old_backtrace"; fi
}


node_diagnostic_context() {
  log "--- DiskMosaic Node/static diagnostic context ---"
  log "Project root: $ROOT"
  log "GUI directory: $GUI_DIR"
  log "Kernel: $(uname -a)"
  log "Node: $($NODE_BIN --version 2>/dev/null || node --version 2>/dev/null || printf 'unavailable')"
  log "npm: $($NPM_BIN --version 2>/dev/null || npm --version 2>/dev/null || printf 'unavailable')"
  log "Renderer test files:"
  find "$GUI_DIR/tests" -maxdepth 1 -type f -name '*.test.cjs' -printf '  %f\n' | sort || true
  log "--- End Node/static diagnostic context ---"
}

run_node_test_suite() {
  local node_cmd="${NODE_BIN:-$(command -v node || true)}"
  [[ -n "$node_cmd" && -x "$node_cmd" ]] || fail "node was not found for renderer/static validation."
  node_diagnostic_context
  log "[Node 1/3] Verifying renderer source..."
  if ! (cd "$GUI_DIR" && "$node_cmd" electron/verify-renderer.cjs); then
    node_diagnostic_context
    fail "Renderer verification failed."
  fi
  log "[Node 2/3] Checking JavaScript/CommonJS syntax file-by-file..."
  local file
  while IFS= read -r -d '' file; do
    if ! "$node_cmd" --check "$file"; then
      log "JavaScript syntax FAILED: $file"
      node_diagnostic_context
      fail "JavaScript/CommonJS syntax validation failed."
    fi
  done < <(find "$GUI_DIR/electron" "$GUI_DIR/renderer" "$GUI_DIR/tests" "$ROOT/scripts" -type f \( -name '*.js' -o -name '*.cjs' \) -print0)
  log "[Node 3/3] Running full static/Electron regression suite with spec reporter..."
  if ! (cd "$GUI_DIR" && "$node_cmd" --test --test-reporter=spec tests/*.test.cjs); then
    log "Node/static suite FAILED. Re-running each test file independently for fault localization..."
    local test_file rc
    for test_file in "$GUI_DIR"/tests/*.test.cjs; do
      log "--- Focused Node diagnostics: $(basename "$test_file") ---"
      rc=0
      (cd "$GUI_DIR" && "$node_cmd" --test --test-reporter=spec "$test_file") || rc=$?
      log "--- Focused result: $(basename "$test_file") exit code $rc ---"
    done
    node_diagnostic_context
    fail "Node/static tests failed. The log includes per-file reruns and environment context."
  fi
}

audit_rust_licenses() {
  local metadata="$DEPS_DIR/rust-license-metadata.json"
  local report="$DEPS_DIR/rust-license-audit.md"
  local licenses="$DEPS_DIR/rust-third-party-licenses.txt"
  log "Auditing the exact resolved Rust dependency licenses..."
  (cd "$RUST_ENGINE_DIR" && cargo metadata --locked --format-version 1 --manifest-path "$RUST_ENGINE_MANIFEST" > "$metadata")
  "$NODE_BIN" "$ROOT/scripts/audit-rust-licenses.cjs" "$metadata" "$report" "$licenses"
  rm -f "$metadata"
}

assert_release_audit() {
  [[ -f "$DEPS_DIR/rust-license-audit.md" ]] || fail "Resolved Rust license audit is missing. Run scripts/build.sh first (or scripts/run.sh for the all-in-one flow)."
  [[ -f "$DEPS_DIR/rust-third-party-licenses.txt" ]] || fail "Collected Rust dependency license texts are missing. Run scripts/build.sh first."
}

check_engine_build_paths() {
  local exe="$CARGO_TARGET_DIR/release/diskmosaic-engine"
  [[ -x "$exe" ]] || fail "Release engine is missing before build-path privacy check: $exe"
  "$NODE_BIN" "$ROOT/scripts/check-binary-paths.cjs" "$exe" \
    "$ROOT" "$RUST_WORK_ROOT" "${CARGO_HOME:-}" "$CARGO_TARGET_DIR" "${TMPDIR:-}"
}

build_engine_release() {
  log "Building Rust engine (release) from isolated staging workspace..."
  (cd "$RUST_ENGINE_DIR" && cargo build --locked --release --manifest-path "$RUST_ENGINE_MANIFEST")
  check_engine_build_paths
}

engine_needs_build() {
  local exe="$CARGO_TARGET_DIR/release/diskmosaic-engine"
  [[ -x "$exe" ]] || return 0
  if find "$ROOT/engine/src" "$ENGINE_MANIFEST" -type f -newer "$exe" -print -quit | grep -q .; then return 0; fi
  return 1
}

copy_engine_for_packaging() {
  local exe="$CARGO_TARGET_DIR/release/diskmosaic-engine"
  [[ -x "$exe" ]] || fail "Release engine is missing: $exe"
  mkdir -p "$GUI_DIR/resources/engine"
  cp -f "$exe" "$GUI_DIR/resources/engine/diskmosaic-engine"
  chmod +x "$GUI_DIR/resources/engine/diskmosaic-engine"
  rm -f "$GUI_DIR/resources/engine/diskmosaic-engine.exe"
}

assert_engine_staged_for_packaging() {
  local engine="$GUI_DIR/resources/engine/diskmosaic-engine"
  [[ -x "$engine" ]] || fail "Packaged engine is not staged. Run scripts/build.sh first (or scripts/run.sh for the all-in-one flow)."
}
