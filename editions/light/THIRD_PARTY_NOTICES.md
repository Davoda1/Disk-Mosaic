# Third-party notices — DiskMosaic Light 1.0.1

DiskMosaic application code and original artwork are licensed under the
AGPL-3.0-only license in [LICENSE](LICENSE). Third-party software retains its own license. This summary does
not replace upstream license texts or notices.

## Direct dependencies

| Component | Version | Declared license |
| --- | --- | --- |
| Electron | 45.2.2 | MIT |
| `@electron/packager` | 20.3.0 | BSD-2-Clause |
| `@electron/asar` | 4.3.1 | MIT |
| serde | 1.0.219 | MIT OR Apache-2.0 |
| serde_json | 1.0.143 | MIT OR Apache-2.0 |
| crossbeam-channel | 0.5.15 | MIT OR Apache-2.0 |
| parking_lot | 0.12.4 | MIT OR Apache-2.0 |
| fs2 | 0.4.3 | MIT OR Apache-2.0 |
| trash | 5.2.3 | MIT |
| blake3 | 1.5.5 | CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception |
| notify | 7.0.0 | CC0-1.0 |
| rusqlite | 0.32.1 | MIT |
| windows-sys | 0.61.0 | MIT OR Apache-2.0 |
| Node.js | 26.13.0 LTS (build tool) | MIT |
| npm CLI | 11.20.0 (build tool) | Artistic-2.0 |

`rusqlite` is built with its `bundled` feature. The corresponding wrapper crate license is
audited through Cargo metadata; upstream SQLite describes its source as public domain.

## Resolved Rust graph and license texts

DiskMosaic's build process audits the **exact resolved Cargo graph** and generates:

- `RUST_DEPENDENCIES.md` — crate names, exact versions, SPDX expressions, and sources;
- `RUST_THIRD_PARTY_LICENSES.txt` — license/notice texts collected from the exact resolved
  crate packages where supplied.

Those files are included in binary distributions. The build fails if a resolved Rust package
has missing or unreviewed license metadata. See the [licensing audit](LICENSING-AUDIT.md) for the audit policy.

Electron distributions also retain Electron/Chromium's generated license material, including
`LICENSE.electron.txt` and `LICENSES.chromium.html`.
