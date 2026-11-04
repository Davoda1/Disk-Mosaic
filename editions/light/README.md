# DiskMosaic Light 1.0.1

DiskMosaic Light provides the compact disk-analysis interface for Windows 10/11 x64 and Linux amd64. It runs locally and offline, with a Rust filesystem engine and sandboxed Electron interface.

[Download 1.0.1](https://github.com/Davoda1/Disk-Mosaic/releases/tag/v1.0.1) · [User guide](https://github.com/Davoda1/Disk-Mosaic/blob/master/docs/USER-GUIDE.md) · [Compare editions](https://github.com/Davoda1/Disk-Mosaic#compare-editions)

## Features

- Logical and allocated-size analysis, interactive cushioned 2D and extruded 3D treemaps.
- Search, extension/category colors, hidden-entry display modes and scan exclusions.
- Exact duplicate verification, reviewed Trash/Recycle Bin actions and saved-scan comparison.
- Optional local SQLite history, incremental refresh and native filesystem watching.
- JSON report export and light or dark appearance, including automatic operating-system theme selection.
- English, German, Hungarian, French, Italian and Spanish interfaces.

This edition has its own application identity and settings/history directory. Its history database should not be shared with the other edition.

## Build and validate

Use **Node.js 26.13.0 LTS** with **npm 11.20.0**, Rust/Cargo, and the platform's native build tools. Run commands from this edition's directory.

| Task | Linux | Windows · PowerShell 7 |
| --- | --- | --- |
| Build and test | `./scripts/build.sh` | `./scripts/build.ps1` |
| Package the built application | `./scripts/package.sh` | `./scripts/package.ps1` |
| Build, test, and package | `./scripts/run.sh` | `./scripts/run.ps1` |

The build runs Node and Rust tests and audits resolved dependency licenses. Use the committed `engine/Cargo.lock` and `gui/package-lock.json`; dependency updates require a new review. See the [script guide](scripts/README.md) for prerequisites and package layouts.

Quick checks:

```bash
npm --prefix gui test
npm --prefix gui run build:renderer
cargo test --locked --manifest-path engine/Cargo.toml
```

See the [architecture](docs/ARCHITECTURE.md) and [engine protocol](docs/IPC.md) for implementation details. The [shared build guide](https://github.com/Davoda1/Disk-Mosaic/blob/master/docs/BUILDING.md) covers repository and standalone-source workflows.

## Privacy and safety

Normal scans read metadata; duplicate verification reads candidate contents. Network requests, remote content, telemetry and automatic cleanup are absent. Explicit file actions use structured native APIs. Saved/history models cannot perform live destructive actions. Reports and snapshots can contain file paths and should be reviewed before sharing.

## License

Application source and original assets: **AGPL-3.0-only**. See the [license](LICENSE), [third-party notices](THIRD_PARTY_NOTICES.md), and [licensing audit](LICENSING-AUDIT.md). Third-party components retain their own notices and license terms.
