#!/usr/bin/env bash
set -euo pipefail

# Assemble a Debian package without installing it or changing host permissions.
# Usage: _package_deb.sh <edition-root> <unpacked-app> <deb-path>
ROOT="${1:?edition root is required}"
UNPACKED="${2:?unpacked application path is required}"
DEB="${3:?deb path is required}"
NODE_BIN="${NODE_BIN:-node}"
for command in dpkg-deb dpkg-parsechangelog md5sum gzip cc; do
  command -v "$command" >/dev/null 2>&1 || { printf 'Required packaging tool is missing: %s\n' "$command" >&2; exit 1; }
done
[[ -d "$UNPACKED" ]] || { printf 'Unpacked application is missing.\n' >&2; exit 1; }
PACKAGE_NAME="$("$NODE_BIN" -p 'require(process.argv[1]).name' "$ROOT/gui/package.json")"
PRODUCT_NAME="$("$NODE_BIN" -p 'require(process.argv[1]).build.productName' "$ROOT/gui/package.json")"
VERSION="$("$NODE_BIN" -p 'require(process.argv[1]).version' "$ROOT/gui/package.json")"
EXECUTABLE="$("$NODE_BIN" -p 'require(process.argv[1]).build.linux.executableName' "$ROOT/gui/package.json")"
[[ "$PACKAGE_NAME" =~ ^[a-z][a-z0-9-]+$ && "$EXECUTABLE" == "$PACKAGE_NAME" && "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf 'Invalid package identity.\n' >&2; exit 1; }

TMP_BASE="${TMPDIR:-$ROOT/dependencies/tmp}"
mkdir -p "$TMP_BASE"
STAGE="$(mktemp -d "$TMP_BASE/diskmosaic-deb-package.XXXXXX")"
CHECK=""
cleanup() { rm -rf "$STAGE"; [[ -z "$CHECK" ]] || rm -rf "$CHECK"; }
trap cleanup EXIT

APP_DIR="$STAGE/opt/$PACKAGE_NAME"
mkdir -p "$STAGE/DEBIAN" "$STAGE/opt"
cp -a "$UNPACKED" "$APP_DIR"
# Ubuntu 24.04+ restricts unprivileged user namespaces with AppArmor. This
# profile keeps Electron's renderer sandbox available at the installed path.
cat > "$APP_DIR/resources/apparmor-profile" <<APPARMOR_PROFILE
abi <abi/4.0>,
include <tunables/global>

profile "$PACKAGE_NAME" "/opt/$PACKAGE_NAME/$EXECUTABLE" flags=(unconfined) {
  userns,
  include if exists <local/$PACKAGE_NAME>
}
APPARMOR_PROFILE
ICON_DIR="$STAGE/usr/share/icons/hicolor/512x512/apps"
mkdir -p "$ICON_DIR"
install -m 0644 "$ROOT/gui/renderer/assets/icon.png" "$ICON_DIR/$PACKAGE_NAME.png"
[[ -x "$APP_DIR/$EXECUTABLE" && ! -L "$APP_DIR/$EXECUTABLE" ]] || { printf 'Packaged application executable is missing.\n' >&2; exit 1; }

# /usr/bin contains a native ELF, not a link or a shell script. execv keeps the
# Electron runtime adjacent to its resources and forwards arguments unchanged.
mkdir -p "$STAGE/usr/bin"
rm -f "$STAGE/usr/bin/$EXECUTABLE"
cc -Os -s -Wall -Wextra -Werror \
  "-DDISKMOSAIC_EXECUTABLE=\"/opt/$PACKAGE_NAME/$EXECUTABLE\"" \
  "$ROOT/scripts/debian-entry.c" -o "$STAGE/usr/bin/$EXECUTABLE"
chmod 0755 "$STAGE/usr/bin/$EXECUTABLE"

DOC_DIR="$STAGE/usr/share/doc/$PACKAGE_NAME"
mkdir -p "$DOC_DIR"
install -m 0644 "$ROOT/LICENSE" "$DOC_DIR/LICENSE"
install -m 0644 "$ROOT/LICENSE" "$DOC_DIR/copyright"
install -m 0644 "$ROOT/THIRD_PARTY_NOTICES.md" "$DOC_DIR/THIRD_PARTY_NOTICES.md"
install -m 0644 "$ROOT/LICENSING-AUDIT.md" "$DOC_DIR/LICENSING-AUDIT.md"
install -m 0644 "$ROOT/dependencies/rust-license-audit.md" "$DOC_DIR/RUST_DEPENDENCIES.md"
install -m 0644 "$ROOT/dependencies/rust-third-party-licenses.txt" "$DOC_DIR/RUST_THIRD_PARTY_LICENSES.txt"

DEBIAN_CHANGELOG="$STAGE/debian-changelog"
cat > "$DEBIAN_CHANGELOG" <<CHANGELOG
$PACKAGE_NAME ($VERSION) unstable; urgency=medium

  * $PRODUCT_NAME $VERSION release.

 -- davoda1 <maintainers@example.invalid>  Wed, 04 Nov 2026 00:00:00 +0000
CHANGELOG
[[ "$(dpkg-parsechangelog -l"$DEBIAN_CHANGELOG" -S Version)" == "$VERSION" ]]
[[ "$(dpkg-parsechangelog -l"$DEBIAN_CHANGELOG" -S Distribution)" == "unstable" ]]
gzip -n -9 -c "$DEBIAN_CHANGELOG" > "$DOC_DIR/changelog.Debian.gz"
gzip -n -9 -c "$DEBIAN_CHANGELOG" > "$DOC_DIR/changelog.gz"
rm "$DEBIAN_CHANGELOG"

CONTROL="$STAGE/DEBIAN/control"
cat > "$CONTROL" <<CONTROL_METADATA
Package: $PACKAGE_NAME
Version: $VERSION
Architecture: amd64
Maintainer: davoda1 <maintainers@example.invalid>
Section: utils
Priority: optional
Homepage: https://github.com/Davoda1/Disk-Mosaic
Depends: libc6 (>= 2.35), libgcc-s1, libstdc++6, libasound2t64 | libasound2, libatk-bridge2.0-0t64 | libatk-bridge2.0-0, libatk1.0-0t64 | libatk1.0-0, libatspi2.0-0t64 | libatspi2.0-0, libcairo2, libcups2t64 | libcups2, libdbus-1-3, libdrm2, libexpat1, libgbm1, libglib2.0-0t64 | libglib2.0-0, libgtk-3-0t64 | libgtk-3-0, libnspr4, libnss3, libpango-1.0-0, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2, libxss1, libxtst6, libnotify4, libsecret-1-0, libuuid1, xdg-utils
Recommends: libayatana-appindicator3-1 | libappindicator3-1
Description: Offline visual disk usage analyzer
 $PRODUCT_NAME scans local files with a Rust engine and displays their sizes
 in an interactive Electron interface. No network account is required.
CONTROL_METADATA

# These scripts run only under dpkg during installation/removal. Ownership and
# sandbox fallback permissions are recorded in the package during assembly.
for script in postinst postrm; do
  cat > "$STAGE/DEBIAN/$script" <<'MAINTENANCE'
#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
fi
exit 0
MAINTENANCE
  chmod 0755 "$STAGE/DEBIAN/$script"
done

# Retain Electron's Ubuntu AppArmor integration after relocating the payload.
# The dry run preserves compatibility with distributions using an older ABI.
sed -i '$d' "$STAGE/DEBIAN/postinst"
cat >> "$STAGE/DEBIAN/postinst" <<POSTINSTALL
profile_source='/opt/$PACKAGE_NAME/resources/apparmor-profile'
profile_target='/etc/apparmor.d/$PACKAGE_NAME'
POSTINSTALL
cat >> "$STAGE/DEBIAN/postinst" <<'APPARMOR_INSTALL'
if [ -f "$profile_source" ] && command -v apparmor_status >/dev/null 2>&1 && command -v apparmor_parser >/dev/null 2>&1 && apparmor_status --enabled >/dev/null 2>&1; then
  if apparmor_parser --skip-kernel-load --debug "$profile_source" >/dev/null 2>&1; then
    install -m 0644 "$profile_source" "$profile_target"
    if ! { command -v ischroot >/dev/null 2>&1 && ischroot; }; then
      apparmor_parser --replace --write-cache --skip-read-cache "$profile_target" || true
    fi
  fi
fi
exit 0
APPARMOR_INSTALL
sed -i '$d' "$STAGE/DEBIAN/postrm"
cat >> "$STAGE/DEBIAN/postrm" <<POSTREMOVE
profile_target='/etc/apparmor.d/$PACKAGE_NAME'
POSTREMOVE
cat >> "$STAGE/DEBIAN/postrm" <<'APPARMOR_REMOVE'
case "${1:-}" in
  remove|purge)
    if [ -f "$profile_target" ]; then
      if command -v apparmor_parser >/dev/null 2>&1; then apparmor_parser --remove "$profile_target" >/dev/null 2>&1 || true; fi
      rm -f "$profile_target"
    fi
    ;;
esac
exit 0
APPARMOR_REMOVE

DESKTOP="$STAGE/usr/share/applications/$PACKAGE_NAME.desktop"
mkdir -p "$(dirname "$DESKTOP")"
cat > "$DESKTOP" <<DESKTOP_ENTRY
[Desktop Entry]
Name=$PRODUCT_NAME
Comment=Offline disk usage analyzer
Exec=/usr/bin/$EXECUTABLE %U
Terminal=false
Type=Application
Icon=$PACKAGE_NAME
Categories=Utility;
StartupWMClass=$PACKAGE_NAME
DESKTOP_ENTRY
chmod 0644 "$DESKTOP"

# Normalize only this disposable staging tree. dpkg-deb records root ownership;
# chrome-sandbox remains available as Chromium's setuid fallback where required.
chmod -R go-w "$STAGE"
find "$STAGE" -type d -exec chmod 0755 {} +
chmod 0755 "$APP_DIR/$EXECUTABLE" "$APP_DIR/resources/engine/diskmosaic-engine"
chmod 0644 "$APP_DIR/resources/app.asar"
chmod 4755 "$APP_DIR/chrome-sandbox"
installed_kib="$(du -sk --exclude=DEBIAN "$STAGE" | awk '{print $1}')"
if grep -q '^Installed-Size:' "$CONTROL"; then
  sed -i "s/^Installed-Size:.*/Installed-Size: $installed_kib/" "$CONTROL"
else
  printf 'Installed-Size: %s\n' "$installed_kib" >> "$CONTROL"
fi
(
  cd "$STAGE"
  find . -path './DEBIAN' -prune -o -type f -print0 \
    | sort -z | xargs -0 md5sum | sed 's#  \./#  #' > DEBIAN/md5sums
)
chmod 0644 "$STAGE/DEBIAN/control" "$STAGE/DEBIAN/md5sums"
OUT="${DEB}.finalized"
dpkg-deb -Zxz -z3 --build --root-owner-group "$STAGE" "$OUT" >/dev/null
mv -f "$OUT" "$DEB"

# Verify the exact output archive, including a real ELF at /usr/bin.
CHECK="$(mktemp -d "$TMP_BASE/diskmosaic-deb-check.XXXXXX")"
dpkg-deb -x "$DEB" "$CHECK/root"
dpkg-deb -e "$DEB" "$CHECK/control"
ENTRY="$CHECK/root/usr/bin/$EXECUTABLE"
[[ -f "$ENTRY" && ! -L "$ENTRY" && "$(stat -c '%a' "$ENTRY")" == 755 ]]
[[ "$(od -An -tx1 -N4 "$ENTRY" | tr -d ' \n')" == 7f454c46 ]]
for file in LICENSE copyright THIRD_PARTY_NOTICES.md LICENSING-AUDIT.md RUST_DEPENDENCIES.md RUST_THIRD_PARTY_LICENSES.txt; do
  [[ -f "$CHECK/root/usr/share/doc/$PACKAGE_NAME/$file" ]]
done
gzip -dc "$CHECK/root/usr/share/doc/$PACKAGE_NAME/changelog.Debian.gz" > "$CHECK/changelog"
[[ "$(dpkg-parsechangelog -l"$CHECK/changelog" -S Version)" == "$VERSION" ]]
[[ "$(dpkg-parsechangelog -l"$CHECK/changelog" -S Distribution)" == unstable ]]
grep -q '^Recommends: libayatana-appindicator3-1 | libappindicator3-1$' "$CHECK/control/control"
[[ "$(stat -c '%a' "$CHECK/root/opt/$PACKAGE_NAME/resources/engine/diskmosaic-engine")" == 755 ]]
[[ "$(stat -c '%a' "$CHECK/root/opt/$PACKAGE_NAME/resources/app.asar")" == 644 ]]
[[ "$(stat -c '%a' "$CHECK/root/opt/$PACKAGE_NAME/chrome-sandbox")" == 4755 ]]
[[ "$(stat -c '%a' "$CHECK/root/usr/share/applications/$PACKAGE_NAME.desktop")" == 644 ]]
[[ -f "$CHECK/root/usr/share/icons/hicolor/512x512/apps/$PACKAGE_NAME.png" ]]
printf 'Debian package created: %s\n' "$DEB"
