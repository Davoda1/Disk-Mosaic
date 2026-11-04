# Building, testing and packaging

## Repository and source archives

The repository contains two complete edition directories. All commands below run inside `editions/standard` or `editions/light`, unless explicitly described as repository-root commands. In an edition source archive, its top-level directory is already the edition root.

Use the committed `engine/Cargo.lock` and `gui/package-lock.json`. Normal builds use locked resolution; update dependencies deliberately and review the resulting lockfiles and license reports. Development caches and downloaded tools are not source files.

## Toolchains

The release uses **Node.js 26.13.0 LTS** with **npm 11.20.0**. Install Rust with Cargo and the platform's native compilation tools as well.

| Platform | Additional build and packaging tools |
| --- | --- |
| Linux | C/C++ compiler for bundled SQLite and the native package entry point; `dpkg-deb`, `tar`, and `gzip` for packaging |
| Windows | PowerShell 7 and the Microsoft C++ build tools used by Rust's MSVC target |

CI pins the toolchains it validates. Scripts prefer installed compatible Node.js and do not install Rust or modify global Cargo settings, shell profiles or persistent PATH. Build caches and output belong to `dependencies`, `toolings` and `dist` inside the edition directory.

## Source and engine tests

From the repository root:

```bash
node scripts/verify-source.mjs
npm --prefix editions/standard/gui test
npm --prefix editions/light/gui test
```

From either edition root:

```bash
npm --prefix gui run build:renderer
cargo test --locked --manifest-path engine/Cargo.toml
```

The Rust suite uses controlled temporary fixtures for scanning, snapshots, history, duplicates and platform semantics. Node tests cover bridge security, renderer behavior and release engineering. A passing source-pattern assertion alone does not establish runtime correctness; targeted behavioral tests cover the security boundaries changed in this release.

## Full build

Linux:

```bash
./scripts/build.sh
./scripts/package.sh
```

Windows, in PowerShell 7:

```powershell
./scripts/build.ps1
./scripts/package.ps1
```

The build validates the renderer, runs the Node regression suite and native Rust tests, compiles the engine, audits the exact resolved Rust dependency graph, and stages the engine for Electron. Packaging requires the generated license audit and notices. Packaging-only scripts do not claim to rerun the native tests.

## Package layout

Windows ZIPs contain a real application `.exe` at the root with its required runtime files. Linux TAR.GZ files contain the application binary at the root with their runtime files. Extract the complete archive before launching; do not copy only the executable.

Debian packages put a compiled native entry executable in `/usr/bin/diskmosaic` or `/usr/bin/diskmosaic-light`. It passes arguments to the bundled Electron executable under `/opt/diskmosaic` or `/opt/diskmosaic-light`. No launcher script or executable symlink is used. The small entry point is compiled from the included C source. This arrangement keeps each edition's runtime and resources separate.

The sandbox helper's root ownership and setuid mode are encoded in the Linux package/archive metadata. Building packages does not run `sudo` or modify host-owned files. Debian installation applies those package permissions. Non-root extraction of a portable TAR cannot recreate root ownership; on systems that prohibit unprivileged user namespaces, install the Debian package.

Release directories contain a single `SHA256SUM.txt` manifest rather than per-file checksum sidecars.

## Source archives

From the repository root:

```bash
python3 scripts/package-source.py
```

This creates standalone edition TAR.XZ files and `SHA256SUM.txt` under `dist/source`. Archives include tracked code, assets, tests, scripts, lockfiles and documentation. They exclude Git internals, toolchains, caches, generated output and user runtime files. The archive script verifies that each dependency lock and license file is present.

## Rendered and platform checks

Standard includes a Chromium fixture-driven layout suite in `gui/tests/layout-runtime.cjs`; see that edition's `docs/GUI-REGRESSION-TESTING.md`. Light includes a corresponding compact-interface smoke suite. These run real renderer HTML/CSS/JavaScript with synthetic bridge replies and do not perform real filesystem mutations. Install the optional Playwright tooling separately and keep browser downloads out of source archives.

Run native builds on both supported operating systems before binary release. Linux validation cannot establish Windows-specific filesystem, window-manager or package behavior. CI artifacts identify the source revision and test scope used for each build.
