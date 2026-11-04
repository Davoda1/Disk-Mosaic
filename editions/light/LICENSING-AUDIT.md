# Dependency licensing policy

DiskMosaic application source and original project assets are licensed under **AGPL-3.0-only**. The complete license is in `LICENSE`. Third-party components retain their own licenses and attribution notices.

The Rust build records the exact resolved dependency graph with `cargo metadata --locked --format-version 1`. `scripts/audit-rust-licenses.cjs` checks declared SPDX expressions against a reviewed permissive/public-domain set, collects available license and notice texts, and writes `dependencies/rust-license-audit.md` and `dependencies/rust-third-party-licenses.txt`. Unrecognized or missing license metadata stops packaging and requires review. This automated metadata check does not establish the provenance of every line of upstream code.

Both generated reports must be present in binary packages. Electron's `LICENSE.electron.txt` and Chromium's `LICENSES.chromium.html` are retained. The bundled SQLite engine is public-domain software; its Rust wrapper has its own license. See `THIRD_PARTY_NOTICES.md` for direct dependencies.

The renderer has no production npm dependencies. Electron provides its desktop runtime; Electron Packager, ASAR, and the rest of the resolved npm graph are build tools. `Cargo.lock` and `package-lock.json` record exact dependency resolution. Dependency updates must regenerate the reports and pass the same tests before packaging.

Release source archives include application source, original assets, tests, build scripts, lockfiles and documentation. They exclude toolchains, dependency caches, compiled products, user scans, user settings, databases, credentials and generated validation files.
