# GUI regression testing — DiskMosaic 1.0.1

The normal build and source validators run the dependency-free Node test suite.
The additional `gui/tests/layout-runtime.cjs` suite runs the actual renderer HTML,
CSS and JavaScript in Chromium with deterministic fixture data. It performs no real
filesystem scans, deletion, history maintenance, or OS file actions.

The test server adds closure access and a simulated bridge only to its in-memory
copy of app.js. Neither the installed renderer nor the Electron preload exposes
these testing capabilities. The server binds to loopback and closes after testing.

## Run the Node checks

From `gui`, run `npm test` and `npm run build:renderer`, or use the existing
`scripts/validate-source.sh` / `scripts/validate-source.ps1` source validators.

## Run rendered checks with project-local tools

Use an installed Node/npm toolchain (or the project-local Node toolchain created by
the existing build scripts). These optional test tools do not change application
or packaging dependencies. From the source root:

```bash
npm install --prefix toolings/layout-tests --no-audit --no-fund playwright@1.62.1
export PLAYWRIGHT_BROWSERS_PATH="$PWD/toolings/layout-tests/browsers"
node toolings/layout-tests/node_modules/playwright/cli.js install chromium
export DISKMOSAIC_PLAYWRIGHT="$PWD/toolings/layout-tests/node_modules/playwright"
node gui/tests/layout-runtime.cjs
```

PowerShell equivalent, from the source root:

```powershell
npm install --prefix toolings/layout-tests --no-audit --no-fund playwright@1.62.1
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD 'toolings/layout-tests/browsers'
node toolings/layout-tests/node_modules/playwright/cli.js install chromium
$env:DISKMOSAIC_PLAYWRIGHT = Join-Path $PWD 'toolings/layout-tests/node_modules/playwright'
node gui/tests/layout-runtime.cjs
```

An existing compatible Chromium executable can instead be supplied using
`DISKMOSAIC_CHROMIUM` (absolute path). `DISKMOSAIC_LAYOUT_OUTPUT` selects a different
output directory. Otherwise screenshots and `results.json` go into
`dependencies/layout-results`. The suite exits nonzero on a failed assertion or
renderer exception. Playwright/Linux browser runtime libraries must be available;
a missing browser is an error, not a silently skipped test.

The optional tool downloads and result files are build/test products. They are excluded
from source release archives and must not be committed.

## Coverage

- All 13 workspace tabs and all 10 Settings sections at 1024×700, 1280×720,
  1600×900 and 1920×1080, in light and dark themes.
- Whole translated tab visibility and all Settings sections in English, German,
  Hungarian, French, Italian and Spanish.
- 125%, 150% and 200% device pixel ratios, including a 960×540 CSS viewport at 200%.
- Empty and populated History, Age, Cleanup, Allocation and Issues layouts,
  including long paths and large counts.
- Progress/summary visibility combinations, footer placement and treemap maximize.
- History zero/one/two-point transitions, stale selection clearing and chart backing
  pixel dimensions; same-ID/invalid-ID rejection also has pure Node tests.
- Count/timestamp truncation, header/row geometry after reordering and horizontal
  scrolling, responsive pane dragging, About above Settings, and directory labels
  in both treemap rendering modes.

This suite checks renderer geometry and interaction decisions. It does not replace
native Rust tests, real scan integration tests, Electron sandbox execution checks,
Windows window-manager testing or packaging validation. Run the existing full build
scripts on each target platform for those gates.
