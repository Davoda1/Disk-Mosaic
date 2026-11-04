# Build and packaging scripts

Run scripts from the edition directory. The release uses Node.js **26.13.0 LTS**
with **npm 11.20.0**. A preinstalled Rust toolchain and the platform's C/C++ build
tools are also required. Debian
packaging additionally uses `dpkg-deb`, `dpkg-parsechangelog`, `cc`, `tar`, and `gzip`.

| Task | Linux | Windows PowerShell 7 |
| --- | --- | --- |
| Source and metadata validation | `./scripts/validate-source.sh` | `./scripts/validate-source.ps1` |
| Test and stage the native engine | `./scripts/build.sh` | `./scripts/build.ps1` |
| Package a staged engine | `./scripts/package.sh` | `./scripts/package.ps1` |
| Build, test, and package | `./scripts/run.sh` | `./scripts/run.ps1` |

The default uses installed Node/npm. Explicit `--latest` (PowerShell `-Latest`)
downloads current Node LTS and npm into the edition's `toolings/` directory.
Dependency versions still come from the committed npm and Cargo lockfiles.
Builds use `npm ci` and Cargo `--locked`; they do not update either lockfile.
Rust is never installed or updated by these scripts. Generated dependency state,
cache, temporary files, and build output stay in the edition directory.

Build scripts do not request elevation, start the application, or disable the
Electron sandbox. Compiler path remapping and a binary-path check keep local
checkout/cache paths out of the Rust release executable. Dependency license
metadata and license texts are generated before packaging and included in the
packages together with the project license and Electron/Chromium notices.

## Package layouts

Windows ZIP archives contain the application EXE at the archive root, alongside
its runtime files. Extract the entire ZIP before starting the EXE.

Linux TAR.GZ archives contain the application binary at the archive root. The
archive records root ownership and the normal Chromium sandbox fallback mode.
Ordinary extraction can use unprivileged user namespaces where supported; a user
extracting files without root privileges cannot grant root ownership to the
setuid sandbox helper. The Debian package provides the installed fallback.

Debian packages install a small native ELF entry executable in
`/usr/bin/diskmosaic` or `/usr/bin/diskmosaic-light`. Its complete source is
[`debian-entry.c`](debian-entry.c). It calls `execv` directly, forwards the original
arguments without a shell, and preserves exit status and signals. The Electron
application and resources remain together under `/opt/diskmosaic` or
`/opt/diskmosaic-light`. There is no launcher script or symlink at `/usr/bin`.
The two editions have different executable, desktop-entry, icon, and package
names and can be installed together.

Each output directory has one `SHA256SUM.txt` covering the release artifacts in
that directory. The manifest does not include itself. Package generation and
metadata normalization do not install the package or change host permissions.
