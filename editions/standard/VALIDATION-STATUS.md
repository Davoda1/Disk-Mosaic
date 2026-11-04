# Validation

Run the automated checks in the [edition README](README.md) and the [renderer testing guide](docs/GUI-REGRESSION-TESTING.md). CI records results for each tested source revision. Source checks, rendered-interface checks, and native Windows/Linux package validation cover different behavior and should be reviewed together.

Binary release workflows run source tests, Rust engine tests, package structure checks, and dependency license checks separately on Windows and Linux. Renderer layout tests use synthetic fixture data and do not perform real filesystem actions.
