# Contributing

DiskMosaic contains two independently runnable editions under `editions/standard` and `editions/light`. Keep shared correctness and security fixes aligned while preserving Light's compact interface. Each edition has its own manifest, dependency locks, source, tests and package scripts.

Use descriptive commits and explain the user-visible behavior being changed. Add focused regression coverage for correctness, security or packaging fixes. Run the affected Node tests and Rust tests locally, and run both editions when changing shared behavior. Windows-specific code requires Windows validation; Linux-specific code requires Linux validation.

Do not include credentials, user scans, private paths, generated caches, toolchains or build products in commits. Use synthetic fixtures in tests and screenshots. Keep documentation suitable for all users and preserve third-party license notices. Dependencies are pinned and locked; updates must include regenerated lockfiles and license reports.

Contributions are accepted under AGPL-3.0-only, the license used by this project. Contributor branches may be submitted from forks; the repository's maintained branch is `master`.
