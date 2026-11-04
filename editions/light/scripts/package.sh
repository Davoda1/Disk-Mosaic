#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

latest=0
case "${1:-}" in
  "") ;;
  -l|--latest) latest=1; shift ;;
  *) fail "Usage: package.sh [-l|--latest]" ;;
esac
[[ $# -eq 0 ]] || fail "Usage: package.sh [-l|--latest]"

preflight
prepare_node "$latest"
ensure_npm_dependencies
assert_engine_staged_for_packaging
assert_release_audit

version="$("$NODE_BIN" -p 'require(process.argv[1]).version' "$GUI_DIR/package.json")"
prefix="$("$NODE_BIN" -p 'require(process.argv[1]).build.productName.replace(/ /g,"-")' "$GUI_DIR/package.json")"
executable="$("$NODE_BIN" -p 'require(process.argv[1]).build.linux.executableName' "$GUI_DIR/package.json")"
stem="$prefix-$version-Linux-x86_64"
[[ "$executable" =~ ^[a-z][a-z0-9-]+$ ]] || fail "Invalid Linux executable name."

rm -rf "$ROOT/dist/package"
mkdir -p "$ROOT/dist/linux"
rm -f "$ROOT/dist/linux/$stem.deb" "$ROOT/dist/linux/$stem.tar.gz" "$ROOT/dist/linux/SHA256SUM.txt"

log "Preparing unpacked Linux x86-64 application..."
"$NODE_BIN" "$SCRIPT_DIR/package-app.cjs" linux
unpacked="$ROOT/dist/package/linux-unpacked"
[[ -x "$unpacked/$executable" && ! -L "$unpacked/$executable" ]] || fail "Unpacked application binary is missing."

# Only the disposable package staging tree is changed. No elevation is requested:
# tar and dpkg-deb record root ownership in the archives independently of the builder.
chmod -R go-w "$unpacked"
chmod 4755 "$unpacked/chrome-sandbox"
log "Creating a portable archive with the real application binary at its root..."
tar_artifact="$ROOT/dist/linux/$stem.tar.gz"
tar --sort=name --owner=0 --group=0 --numeric-owner -cf - -C "$unpacked" . | gzip -n -9 > "$tar_artifact"

log "Packaging Debian x86-64..."
"$SCRIPT_DIR/_package_deb.sh" "$ROOT" "$unpacked" "$ROOT/dist/linux/$stem.deb"

# Check the exact archive, including its top-level executable and license notices.
tar_list="$DEPS_DIR/tmp/portable-tar-list.txt"
tar -tzf "$tar_artifact" > "$tar_list"
grep -Fxq "./$executable" "$tar_list" || fail "Portable archive has no top-level application binary."
for required in LICENSE LICENSE.electron.txt LICENSES.chromium.html THIRD_PARTY_NOTICES.md LICENSING-AUDIT.md RUST_DEPENDENCIES.md RUST_THIRD_PARTY_LICENSES.txt; do
  grep -Fxq "./$required" "$tar_list" || fail "Portable archive is missing $required."
done
rm -f "$tar_list"
sandbox_entry="$(tar --numeric-owner -tzvf "$tar_artifact" ./chrome-sandbox)"
[[ "$sandbox_entry" == -rwsr-xr-x*" 0/0 "* ]] || fail "Portable chrome-sandbox ownership/mode is incorrect."
"$NODE_BIN" "$SCRIPT_DIR/write-checksums.cjs" "$ROOT/dist/linux"
log "Linux packages written to $ROOT/dist/linux. Nothing was launched."
