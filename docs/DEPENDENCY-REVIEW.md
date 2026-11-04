# Dependency review

## Reviewed toolchain and runtime

DiskMosaic 1.0.0 uses the same pinned desktop runtime and packaging dependencies in both editions. Each edition commits its own `gui/package-lock.json` and `engine/Cargo.lock`.

| Component | Version | Purpose |
| --- | --- | --- |
| Node.js | 26.13.0 LTS | Development and release builds |
| npm | 11.20.0 | Package installation and dependency auditing |
| Electron | 45.2.2 | Bundled desktop runtime |
| `@electron/packager` | 20.3.0 | Assemble the platform application |
| `@electron/asar` | 4.3.1 | Package application resources |

Node.js 26 is the latest LTS line at the time of this release. End users run the bundled Electron application and do not need a separate Node.js installation.

## Packaging dependency remediation

Packaging uses Electron Packager together with the platform's TAR, Debian, and PowerShell ZIP tools. The previous electron-builder dependency chain included vulnerable legacy glob dependencies; it has been removed.

The ASAR dependency uses scoped overrides for `glob` **14.0.3** and `minimatch` **11.0.4**. These exclude the affected versions covered by the [glob cancellation advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) and [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249). The overrides apply within the ASAR dependency graph, and packaging regression tests exercise the APIs used to create the application archive.

## Security audit scope

The complete npm graphs were audited on **4 November 2026**. Both editions reported **zero vulnerabilities** across informational, low, moderate, high, and critical severity levels. Each reviewed graph contained 52 resolved dependencies.

Audit the complete npm graph, including development dependencies:

```bash
npm --prefix editions/standard/gui audit --audit-level=low
npm --prefix editions/light/gui audit --audit-level=low
```

Run these commands from the repository root. In a standalone edition source archive, use `npm --prefix gui audit --audit-level=low` instead.

Electron is declared as a development dependency for packaging even though its runtime is distributed. An audit that omits development dependencies therefore does not cover the bundled runtime and build tools. The reviewed graph, the shipped Electron version, native tests, renderer checks, and actual package layouts must all be considered when updating dependencies. Audit results describe the resolved lockfile and advisory database at the time of the check; they do not predict future disclosures.

## License reports

The exact Rust dependency graph is audited for license compliance during each build. Packaging requires generated crate license reports and original third-party notices. A license audit is separate from vulnerability scanning. The application uses AGPL-3.0-only; third-party components retain their own licenses.
