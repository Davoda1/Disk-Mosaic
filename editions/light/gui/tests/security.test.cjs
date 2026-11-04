const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveEnginePath, engineExecutableName } = require('../electron/engine-path.cjs');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('Electron renderer is isolated and sandboxed', () => {
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /webSecurity:\s*true/);
});

test('preload exposes a narrow explicit bridge', () => {
  assert.match(preload, /contextBridge\.exposeInMainWorld\('diskMosaic'/);
  assert.doesNotMatch(preload, /require:\s*require/);
  assert.doesNotMatch(preload, /process:\s*process/);
  assert.doesNotMatch(preload, /fs:/);
  for (const name of ['chooseFolder', 'getStartupPath', 'sendEngine', 'onEngineEvent', 'openPath', 'revealPath', 'copyText', 'saveTextFile', 'saveSnapshotPath', 'openSnapshotPath']) {
    assert.match(preload, new RegExp(`${name}:`));
  }
});

test('local CSP blocks remote connections and external script execution', () => {
  assert.match(html, /default-src 'self'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('main process also blocks network protocols', () => {
  assert.match(main, /onBeforeRequest/);
  for (const scheme of ['http://', 'https://', 'ws://', 'wss://']) assert.ok(main.includes(scheme));
});

test('engine development and packaged paths resolve independently', () => {
  const devLinux = resolveEnginePath({ packaged: false, resourcesPath: '/unused', appDir: '/repo/gui', platform: 'linux' });
  assert.equal(devLinux, path.resolve('/repo/gui', '..', 'dependencies', 'cargo-target', 'release', 'diskmosaic-engine'));
  const packagedLinux = resolveEnginePath({ packaged: true, resourcesPath: '/opt/app/resources', appDir: '/unused', platform: 'linux' });
  assert.equal(packagedLinux, path.join('/opt/app/resources', 'engine', 'diskmosaic-engine'));
  const packagedWindows = resolveEnginePath({ packaged: true, resourcesPath: 'C:\\App\\resources', appDir: 'C:\\unused', platform: 'win32' });
  assert.ok(packagedWindows.endsWith(engineExecutableName('win32')));
});

test('packaging includes the staged Rust engine and Utility category', () => {
  const resource = pkg.build.extraResources.find(item => item.to === 'engine');
  assert.ok(resource, 'engine extraResources entry missing');
  assert.deepEqual(resource.filter.sort(), ['diskmosaic-engine', 'diskmosaic-engine.exe'].sort());
  assert.equal(pkg.build.linux.category, 'Utility');
  assert.equal(pkg.build.deb.packageCategory, 'utils');
});

test('release artifact names and application version are stable', () => {
  assert.equal(pkg.version, '1.0.0');
  assert.equal(pkg.devDependencies.electron, '45.2.2');
  assert.equal(pkg.devDependencies['@electron/packager'], '20.3.0');
  assert.equal(pkg.devDependencies['@electron/asar'], '4.3.1');
  assert.equal(pkg.build.win.artifactName, 'DiskMosaic-Light-${version}-Windows-x86_64.${ext}');
  assert.equal(pkg.build.linux.artifactName, 'DiskMosaic-Light-${version}-Linux-x86_64.${ext}');
});

test('squarified treemap layout conserves area and produces finite rectangles', () => {
  const vm = require('node:vm');
  const treemapSource = fs.readFileSync(path.join(root, 'renderer/treemap.js'), 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(treemapSource, context);
  const items = [
    { id: 1, size: 600 },
    { id: 2, size: 250 },
    { id: 3, size: 100 },
    { id: 4, size: 50 },
  ];
  const rects = context.window.DiskMosaicTreemap.layout(items, 1000, 600);
  assert.equal(rects.length, items.length);
  const area = rects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
  assert.ok(Math.abs(area - 600_000) < 0.01, `unexpected area: ${area}`);
  for (const rect of rects) {
    for (const value of [rect.x, rect.y, rect.w, rect.h]) assert.ok(Number.isFinite(value));
    assert.ok(rect.w >= 0 && rect.h >= 0);
    assert.ok(rect.x >= -1e-9 && rect.y >= -1e-9);
    assert.ok(rect.x + rect.w <= 1000 + 1e-6);
    assert.ok(rect.y + rect.h <= 600 + 1e-6);
  }
});

test('Electron clipboard write is awaited in the main process', () => {
  assert.match(main, /await clipboard\.writeText\(validateClipboardText\(text\)\)/);
});

test('Rust cancellation helper avoids tail-expression MutexGuard lifetime regression', () => {
  const rustMain = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'main.rs'), 'utf8');
  assert.match(rustMain, /fn request_scan_cancel\(state: &EngineState\) -> bool/);
  assert.doesNotMatch(rustMain, /state\.cancel\.lock\(\)\.as_ref\(\)/);
  assert.match(rustMain, /let cancel = state\.cancel\.lock\(\)\.clone\(\);/);
});

test('run scripts are build + package orchestrators and never launch the GUI', () => {
  const scripts = path.resolve(root, '..', 'scripts');
  const runPs = fs.readFileSync(path.join(scripts, 'run.ps1'), 'utf8');
  const runSh = fs.readFileSync(path.join(scripts, 'run.sh'), 'utf8');
  const allScripts = fs.readdirSync(scripts)
    .filter(name => /\.(?:ps1|sh)$/.test(name))
    .map(name => fs.readFileSync(path.join(scripts, name), 'utf8'))
    .join('\n');

  assert.match(runPs, /build\.ps1/);
  assert.match(runPs, /package\.ps1/);
  assert.ok(runPs.indexOf('build.ps1') < runPs.indexOf('package.ps1'));
  assert.match(runSh, /build\.sh/);
  assert.match(runSh, /package\.sh/);
  assert.ok(runSh.indexOf('build.sh') < runSh.indexOf('package.sh'));

  assert.doesNotMatch(allScripts, /npm(?:\.cmd)?\s+(?:run\s+)?start\b/i);
  assert.doesNotMatch(allScripts, /electron\s+\.\s*(?:$|\n)/m);
  assert.doesNotMatch(allScripts, /Launching DiskMosaic/i);
});

test('build and run scripts expose explicit Latest switches', () => {
  const scripts = path.resolve(root, '..', 'scripts');
  for (const name of ['build.ps1', 'run.ps1']) {
    const source = fs.readFileSync(path.join(scripts, name), 'utf8');
    assert.match(source, /param\(\[switch\]\$Latest\)/);
  }
  for (const name of ['build.sh', 'run.sh']) {
    const source = fs.readFileSync(path.join(scripts, name), 'utf8');
    assert.match(source, /-l\|--latest/);
  }
});

test('package scripts are package-only and do not recursively invoke build scripts', () => {
  const scripts = path.resolve(root, '..', 'scripts');
  const ps = fs.readFileSync(path.join(scripts, 'package.ps1'), 'utf8');
  const sh = fs.readFileSync(path.join(scripts, 'package.sh'), 'utf8');
  assert.doesNotMatch(ps, /&\s*\([^\n]*build\.ps1/i);
  assert.doesNotMatch(sh, /["']?\$SCRIPT_DIR\/build\.sh/);
  assert.match(ps, /Assert-EngineStagedForPackaging/);
  assert.match(sh, /assert_engine_staged_for_packaging/);
});

test('build scripts never request elevated privileges', () => {
  const scripts = path.resolve(root, '..', 'scripts');
  for (const name of fs.readdirSync(scripts).filter(name => name.endsWith('.sh'))) {
    const source = fs.readFileSync(path.join(scripts, name), 'utf8');
    assert.doesNotMatch(source, /^\s*sudo\b/m, name);
  }
});

test('scripted Rust and Electron caches are project-local', () => {
  const scripts = path.resolve(root, '..', 'scripts');
  const ps = fs.readFileSync(path.join(scripts, '_common.ps1'), 'utf8');
  const sh = fs.readFileSync(path.join(scripts, '_common.sh'), 'utf8');

  for (const source of [ps, sh]) {
    assert.match(source, /CARGO_HOME/);
    assert.match(source, /CARGO_TARGET_DIR/);
    assert.match(source, /ELECTRON_CACHE/);
    assert.match(source, /electron_config_cache/);
    assert.doesNotMatch(source, /rustup\s+(?:install|update|default|toolchain)/i);
  }
  assert.match(sh, /DEPS_DIR\/cargo-home/);
  assert.match(ps, /Join-Path \$DepsDir 'cargo-home'/);
  assert.match(sh, /RUST_WORK_ROOT="\$DEPS_DIR\/rust-work"/);
  assert.match(sh, /CARGO_TARGET_DIR="\$DEPS_DIR\/cargo-target"/);
  assert.match(sh, /prepare_rust_workspace/);
  assert.match(sh, /cd "\$RUST_ENGINE_DIR"/);
  assert.match(ps, /Join-Path \$DepsDir 'rust-work'/);
  assert.match(ps, /Join-Path \$DepsDir 'cargo-target'/);
  assert.match(ps, /function Prepare-RustWorkspace/);
  assert.match(ps, /Push-Location \$RustEngineDir/);
});


test('visualizer refresh defaults to a larger calmer treemap with independent scan animation', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'renderer/styles.css'), 'utf8');
  assert.match(app, /treemapMaxItems:\s*2200/);
  assert.match(app, /treemapMinPx:\s*4/);
  assert.match(app, /topHeight:\s*48/);
  assert.match(app, /treemapCushion:\s*true/);
  assert.match(app, /treemapCushionStrength:\s*78/);
  assert.match(app, /visualizerRevision:\s*5/);
  assert.match(html, /id="treemapScanOverlay"/);
  assert.match(html, /id="treemapExpandButton"/);
  assert.match(html, /id="treemapFocusButton"/);
  assert.match(html, /id="treemapRootButton"/);
  assert.match(styles, /\.scan-orbit/);
  assert.match(styles, /\.workspace\.treemap-maximized/);
  assert.match(app, /addEventListener\('wheel'/);
  assert.match(app, /event\.key === 'F9'/);
  assert.match(app, /frame\.style\.left/);
  assert.match(app, /frame\.style\.width/);
  assert.doesNotMatch(html, /pac-?man/i);
});

test('tree share bars keep blue default and expose exactly four configurable percentage bands', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'renderer/styles.css'), 'utf8');
  assert.match(app, /treeShareBandColorsEnabled:\s*false/);
  assert.match(app, /treeShareBandColors:\s*\['#2ea043', '#3b82f6', '#d6a700', '#d73a49'\]/);
  assert.match(app, /treeShareBandMaxima:\s*\[5, 75, 80, 100\]/);
  assert.match(app, /TREE_SHARE_BAND_COUNT\s*=\s*4/);
  assert.match(app, /maxima\.findIndex\(maximum => pct <= maximum\)/);
  assert.match(app, /treeShareBandColorsEnabled/);
  assert.match(styles, /\.share-fill\.banded/);
  assert.match(html, /id="settingTreeShareBandColorsEnabled"/);
  for (let index = 1; index <= 4; index += 1) {
    assert.match(html, new RegExp(`id=\"settingTreeShareColor${index}\"`));
    assert.match(html, new RegExp(`id=\"settingTreeShareMax${index}\"`));
  }
  assert.doesNotMatch(html, /add share band|remove share band/i);
});

test('squarified treemap avoids long stripes for equal-sized files', () => {
  const vm = require('node:vm');
  const treemapSource = fs.readFileSync(path.join(root, 'renderer/treemap.js'), 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(treemapSource, context);
  const items = Array.from({ length: 16 }, (_, index) => ({ id: index + 1, size: 100 }));
  const rects = context.window.DiskMosaicTreemap.layout(items, 1000, 600);
  const worstAspect = Math.max(...rects.map(rect => Math.max(rect.w / rect.h, rect.h / rect.w)));
  assert.ok(worstAspect < 2.5, `treemap degenerated into stripe-like tiles: ${worstAspect}`);
});

test('hierarchical treemap preserves directory grouping and full-root area ratios', () => {
  const vm = require('node:vm');
  const treemapSource = fs.readFileSync(path.join(root, 'renderer/treemap.js'), 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(treemapSource, context);
  const items = [
    { id: 1, parent_id: 0, kind: 'directory', name: 'A', size: 600 },
    { id: 2, parent_id: 0, kind: 'file', name: 'root.bin', size: 400 },
    { id: 3, parent_id: 1, kind: 'file', name: 'a.bin', size: 360 },
    { id: 4, parent_id: 1, kind: 'file', name: 'b.bin', size: 240 },
  ];
  const hierarchy = context.window.DiskMosaicTreemap.layoutHierarchy(items, 0, 1000, 500);
  assert.equal(hierarchy.groups.length, 1);
  assert.equal(hierarchy.leaves.length, 3);
  const group = hierarchy.groups[0];
  const a = hierarchy.leaves.find(item => item.id === 3);
  const b = hierarchy.leaves.find(item => item.id === 4);
  const rootFile = hierarchy.leaves.find(item => item.id === 2);
  assert.ok(group && a && b && rootFile);
  assert.ok(a.x >= group.x - 1e-6 && a.y >= group.y - 1e-6);
  assert.ok(a.x + a.w <= group.x + group.w + 1e-6);
  assert.ok(a.y + a.h <= group.y + group.h + 1e-6);
  const fullArea = 500_000;
  assert.ok(Math.abs(group.w * group.h / fullArea - 0.60) < 1e-6);
  assert.ok(Math.abs(rootFile.w * rootFile.h / fullArea - 0.40) < 1e-6);
  assert.ok(Math.abs(a.w * a.h / fullArea - 0.36) < 1e-6);
  assert.ok(Math.abs(b.w * b.h / fullArea - 0.24) < 1e-6);
  const leafArea = hierarchy.leaves.reduce((sum, rect) => sum + rect.w * rect.h, 0);
  assert.ok(Math.abs(leafArea - fullArea) < 0.01);
});

test('treemap backend emits a bounded directory hierarchy with exact remainder rectangles', () => {
  const model = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'model.rs'), 'utf8');
  assert.match(model, /MAX_CHILDREN_PER_DIRECTORY/);
  assert.match(model, /BinaryHeap<\(u64, Reverse<NodeId>\)>/);
  assert.match(model, /parent_id: Some\(directory_id\)/);
  assert.match(model, /NodeKind::Directory => "directory"/);
  assert.match(model, /remainder_size = total_size\.saturating_sub\(selected_size\)/);
  assert.match(model, /kind: "aggregate"\.to_string\(\)/);
});

test('tree view exposes filesystem icons and proportional share indicators', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'renderer/styles.css'), 'utf8');
  assert.match(html, />Share<\/span>/);
  assert.match(app, /share-track/);
  assert.match(app, /share-fill/);
  assert.match(app, /function makeFileIcon\(node\)/);
  assert.match(app, /file-icon file-type icon-/);
  assert.match(styles, /\.file-icon\.directory/);
  assert.match(styles, /\.share-track/);
  assert.match(styles, /\.share-fill/);
});

test('treemap uses stronger configurable 3D cushion shading and directory boundary overlays', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  assert.match(html, /id="settingTreemapCushionStrength"/);
  assert.match(app, /function drawCushionedTile/);
  assert.match(app, /createRadialGradient/);
  assert.match(app, /state\.treemapGroupRects/);
  assert.match(app, /Directory borders are overlays/);
});


test('inherited analysis UI exposes categories, statistics, advanced search, exclusions and report export', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  const scanner = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'scanner.rs'), 'utf8');
  const model = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'model.rs'), 'utf8');
  assert.match(html, /data-view="statistics"/);
  assert.match(html, /id="sizeDistribution"/);
  assert.match(html, /id="ageDistribution"/);
  assert.match(html, /id="searchMinSize"/);
  assert.match(html, /id="searchMaxSize"/);
  assert.match(html, /id="searchModifiedAfter"/);
  assert.match(html, /id="searchModifiedBefore"/);
  assert.match(html, /id="settingExcludePatterns"/);
  assert.match(html, /id="showCategoriesButton"/);
  assert.match(html, /id="exportButton"/);
  assert.match(app, /const DEFAULT_FILE_CATEGORIES = Object\.freeze/);
  assert.match(app, /function renderStatistics/);
  assert.match(app, /function exportReport/);
  assert.match(app, /cmd: 'ancestors'/);
  assert.match(scanner, /exclude_patterns: Vec<String>/);
  assert.match(scanner, /fn wildcard_match/);
  assert.match(model, /pub struct ScanStatistics/);
  assert.match(model, /BinaryHeap<\(Reverse<u64>, NodeId\)>/);
});


test('treemap-to-tree reveal handles children outside the first virtualized page', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  assert.match(app, /function injectAncestorPathChild/);
  assert.match(app, /pathInjected: true/);
  assert.match(app, /rawItems = response\.items \|\| \[\]/);
  assert.match(app, /visibleIds = new Set/);
  assert.match(app, /injectAncestorPathChild\(row, child\)/);
});

test('offline report save is narrow, local and size-bounded', () => {
  assert.match(preload, /saveTextFile:\s*payload => ipcRenderer\.invoke\('dialog:saveTextFile', payload\)/);
  assert.match(main, /handle\('dialog:saveTextFile'/);
  assert.match(main, /path\.basename\(payload\.suggestedName\.trim\(\)\)/);
  assert.match(main, /Buffer\.byteLength\(content, 'utf8'\) > 64 \* 1024 \* 1024/);
  assert.match(main, /fs\.promises\.writeFile\(result\.filePath, content/);
});

test('Latest mode reports versions after project-local npm latest selection', () => {
  const scripts = path.resolve(root, '..', 'scripts');
  const ps = fs.readFileSync(path.join(scripts, '_common.ps1'), 'utf8');
  const sh = fs.readFileSync(path.join(scripts, '_common.sh'), 'utf8');
  const psLatest = ps.indexOf('Use-LatestNpm');
  const psReport = ps.indexOf('Project-local Node:', psLatest);
  assert.ok(psLatest >= 0 && psReport > psLatest, 'PowerShell should report versions after Use-LatestNpm');
  assert.match(ps, /npm: \$\(& \$NpmBin --version\) \(Latest mode\)/);
  const shPrepare = sh.indexOf('if [[ "$latest" == "1" ]]');
  const shLatest = sh.indexOf('use_latest_npm', shPrepare);
  const shReport = sh.indexOf('Project-local Node:', shLatest);
  assert.ok(shPrepare >= 0 && shLatest > shPrepare && shReport > shLatest, 'Linux should report versions after use_latest_npm');
  assert.match(sh, /npm: \$\(\$NPM_BIN --version\) \(Latest mode\)/);
});

test('application licensing and third-party notices are included', () => {
  const projectRoot = path.resolve(root, '..');
  const license = fs.readFileSync(path.join(projectRoot, 'LICENSE'), 'utf8');
  const audit = fs.readFileSync(path.join(projectRoot, 'LICENSING-AUDIT.md'), 'utf8');
  const notices = fs.readFileSync(path.join(projectRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const cargo = fs.readFileSync(path.join(projectRoot, 'engine', 'Cargo.toml'), 'utf8');
  assert.match(license, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.equal(pkg.license, 'AGPL-3.0-only');
  assert.match(cargo, /license = "AGPL-3\.0-only"/);
  assert.match(audit, /cargo metadata/);
  assert.match(notices, /Electron/);
  assert.match(notices, /Rust/);
});

test('retains configurable category rules and actionable analysis buckets', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  assert.match(html, /id="settingCategoryRules"/);
  assert.match(app, /function buildCategoryModel/);
  assert.match(app, /explicitExtensionOwners/);
  assert.match(app, /function applyDistributionSearch/);
  assert.match(app, /distribution-action/);
});

test('scan summary includes filesystem capacity context without raw filesystem parsing', () => {
  const rustMain = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'main.rs'), 'utf8');
  const scanner = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'scanner.rs'), 'utf8');
  const platform = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'platform.rs'), 'utf8');
  assert.match(rustMain, /filesystem_total_bytes/);
  assert.match(rustMain, /filesystem_available_bytes/);
  assert.match(scanner, /filesystem_space\(&path\)/);
  assert.match(platform, /pub fn filesystem_space/);
  assert.match(platform, /fs2::total_space/);
});

test('engine protocol is version 4 and exposes statistics/ancestor queries', () => {
  const rustMain = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'main.rs'), 'utf8');
  assert.match(rustMain, /"protocol":4,"version":env!\("CARGO_PKG_VERSION"\)/);
  assert.match(rustMain, /"ancestors" =>/);
  assert.match(rustMain, /"statistics" =>/);
  assert.match(rustMain, /"excluded": model\.excluded_count/);
});

test('retains allocated-size semantics and selectable size basis end to end', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  const model = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'model.rs'), 'utf8');
  const scanner = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'scanner.rs'), 'utf8');
  const platform = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'platform.rs'), 'utf8');
  assert.match(html, /id="logicalBasisButton"/);
  assert.match(html, /id="allocatedBasisButton"/);
  assert.match(html, />Allocated<\/button>/);
  assert.match(html, /id="detailAllocated"/);
  assert.match(model, /pub allocated_size: u64/);
  assert.match(model, /pub enum SizeBasis/);
  assert.match(model, /remainder_allocated/);
  assert.match(scanner, /allocated_bytes/);
  assert.match(platform, /GetCompressedFileSizeW/);
  assert.match(platform, /metadata\.blocks\(\)\.saturating_mul\(512\)/);
  assert.match(app, /size_basis: state\.sizeBasis/);
});

test('allocated-basis search and Largest Files are computed in Rust rather than relabelled in the renderer', () => {
  const mainRs = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'main.rs'), 'utf8');
  const model = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'model.rs'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  assert.match(mainRs, /let basis = SizeBasis::parse\(command\.get\("size_basis"\)/);
  assert.match(model, /pub fn largest_files\(&self, limit: usize, basis: SizeBasis\)/);
  assert.match(model, /node\.allocated_size/);
  assert.match(model, /self\.size_for\(node, basis\)/);
  assert.match(app, /cmd: 'largest', limit, size_basis: state\.sizeBasis/);
  assert.match(app, /size_basis: state\.sizeBasis,/);
});

test('retains .dmscan snapshot load/save and bounded comparison', () => {
  const mainRs = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'main.rs'), 'utf8');
  const snapshot = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'snapshot.rs'), 'utf8');
  assert.match(html, /id="openSnapshotButton"/);
  assert.match(html, /id="saveSnapshotButton"/);
  assert.match(html, /data-view="compare"/);
  assert.match(preload, /saveSnapshotPath:/);
  assert.match(preload, /openSnapshotPath:/);
  assert.match(main, /dialog:saveSnapshotPath/);
  assert.match(main, /dialog:openSnapshotPath/);
  assert.match(mainRs, /"save_snapshot"/);
  assert.match(mainRs, /"load_snapshot"/);
  assert.match(mainRs, /"compare_snapshot"/);
  assert.match(snapshot, /const SNAPSHOT_FORMAT: u32 = 1/);
  assert.match(snapshot, /BinaryHeap/);
  assert.match(snapshot, /compatible_root/);
});

test('duplicate finder retains staged filtering and exact byte verification', () => {
  const dupes = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'duplicates.rs'), 'utf8');
  assert.match(html, /data-view="duplicates"/);
  assert.match(dupes, /by_size: HashMap<u64, Vec<NodeId>>/);
  assert.match(dupes, /sample_hash/);
  assert.match(dupes, /files_equal/);
  assert.match(dupes, /hardlink_duplicate/);
  assert.match(dupes, /recoverable_allocated/);
  assert.match(dupes, /cancel\.load\(Ordering::Relaxed\)/);
});

test('scan pause/resume reaches the Rust worker loop and remains cancellable', () => {
  const mainRs = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'main.rs'), 'utf8');
  const scanner = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'scanner.rs'), 'utf8');
  assert.match(html, /id="pauseButton"/);
  assert.match(mainRs, /"pause" =>/);
  assert.match(mainRs, /"resume" =>/);
  assert.match(scanner, /fn wait_if_paused/);
  assert.match(scanner, /shared\.pause\.load/);
  assert.match(scanner, /!shared\.cancel\.load/);
});

test('UI retains scan overview, storage insights, duplicate and comparison workspaces', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'renderer/styles.css'), 'utf8');
  assert.match(html, /id="scanSummaryStrip"/);
  assert.match(html, /id="storageInsights"/);
  assert.match(html, /id="duplicateSummary"/);
  assert.match(html, /id="compareSummary"/);
  assert.match(app, /function updateScanSummaryStrip/);
  assert.match(app, /function renderStorageInsights/);
  assert.match(styles, /\.scan-summary-strip/);
  assert.match(styles, /\.summary-chip/);
});

test('architecture documentation covers the scanner, bridge and local history', () => {
  const projectRoot = path.resolve(root, '..');
  const architecture = fs.readFileSync(path.join(projectRoot, 'docs', 'ARCHITECTURE.md'), 'utf8');
  for (const term of ['Rust', 'Electron', 'SQLite', 'treemap']) {
    assert.match(architecture, new RegExp(term, 'i'));
  }
});

test('scripted Cargo builds stage dependency and target state outside engine source', () => {
  const scripts = path.resolve(root, '..', 'scripts');
  const ps = fs.readFileSync(path.join(scripts, '_common.ps1'), 'utf8');
  const sh = fs.readFileSync(path.join(scripts, '_common.sh'), 'utf8');
  const buildPs = fs.readFileSync(path.join(scripts, 'build.ps1'), 'utf8');
  const buildSh = fs.readFileSync(path.join(scripts, 'build.sh'), 'utf8');
  assert.match(sh, /cp "\$ENGINE_MANIFEST" "\$RUST_ENGINE_MANIFEST"/);
  assert.match(sh, /cp -a "\$ENGINE_DIR\/src" "\$RUST_ENGINE_DIR\/src"/);
  assert.match(buildSh, /run_rust_test_suite/);
  assert.match(sh, /cd "\$RUST_ENGINE_DIR"/);
  assert.doesNotMatch(buildSh + sh, /--manifest-path "?\$ENGINE_MANIFEST/);
  assert.match(ps, /Copy-Item -Force \$EngineManifest \$RustEngineManifest/);
  assert.match(ps, /Copy-Item -Recurse -Force \(Join-Path \$EngineDir 'src'\)/);
  assert.match(buildPs, /Invoke-RustTestSuite/);
  assert.match(ps, /Push-Location \$RustEngineDir/);
  assert.doesNotMatch(buildPs + ps, /--manifest-path \$EngineManifest/);
});


test('Rust validation emits high-detail diagnostics and focused reruns on failure', () => {
  const scripts = path.resolve(root, '..', 'scripts');
  const ps = fs.readFileSync(path.join(scripts, '_common.ps1'), 'utf8');
  const sh = fs.readFileSync(path.join(scripts, '_common.sh'), 'utf8');
  for (const source of [ps, sh]) {
    assert.match(source, /RUST_BACKTRACE/);
    assert.match(source, /--no-run/);
    assert.match(source, /--nocapture/);
    assert.match(source, /--test-threads=1/);
    for (const subsystem of ['history::tests::', 'model::tests::', 'watcher::tests::', 'duplicates::tests::', 'snapshot::tests::', 'scanner::tests::']) {
      assert.ok(source.includes(subsystem), `missing focused diagnostic filter ${subsystem}`);
    }
  }
  assert.match(ps, /Write-RustDiagnosticContext/);
  assert.match(sh, /rust_diagnostic_context/);
});

test('SQLite history SQL is whitespace-safe and regression-tested before runtime use', () => {
  const history = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'history.rs'), 'utf8');
  assert.doesNotMatch(history, /node_countFROM/);
  assert.doesNotMatch(history, /node_count\\\s*\n\s*FROM/);
  assert.match(history, /const LIST_SCANS_SQL:[\s\S]*node_count[\s\S]*FROM scans/);
  assert.match(history, /const LOAD_SCAN_SQL:[\s\S]*node_count[\s\S]*FROM scans/);
  assert.match(history, /history_sql_statements_prepare_against_schema/);
  assert.match(history, /history_schema_contains_required_tables_columns_and_indexes/);
  assert.match(history, /history_store_rolls_back_when_integer_exceeds_sqlite_range/);
  assert.match(history, /history_rejects_newer_schema_without_overwriting_version/);
});

test('filesystem-used ratio is suppressed when a cross-filesystem scan makes it invalid', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  assert.match(app, /volumeUsed > 0 && scanned <= volumeUsed/);
  assert.doesNotMatch(app, /Math\.min\(999, scanned \/ volumeUsed/);
});

test('dominant tree entries are visually emphasized without changing size semantics', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'renderer/styles.css'), 'utf8');
  assert.match(app, /row\.depth > 0 && pct >= 10/);
  assert.match(app, /line\.classList\.add\('dominant-item'\)/);
  assert.match(styles, /\.tree-row\.dominant-item/);
});


test('app grid reserves independent progress and summary tracks without stealing workspace height', () => {
  const styles = fs.readFileSync(path.join(root, 'renderer/styles.css'), 'utf8');
  assert.match(styles, /grid-template-rows:\s*48px auto auto minmax\(0,\s*1fr\) 28px/);
  assert.match(styles, /grid-template-rows:\s*44px auto auto minmax\(0,1fr\) 25px/);
});

test('snapshot saving serializes the live model by reference and preserves an existing snapshot until replacement succeeds', () => {
  const snapshot = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'snapshot.rs'), 'utf8');
  assert.match(snapshot, /SnapshotFileRef/);
  assert.doesNotMatch(snapshot, /model:\s*model\.clone\(\)/);
  assert.match(snapshot, /let mut backup = path\.as_os_str\(\)\.to_os_string\(\)/);
  assert.match(snapshot, /fs::rename\(path, &backup\)/);
  assert.match(snapshot, /fs::rename\(tmp, path\)/);
});

test('comparison rows retain current node IDs so changed items can navigate back into the live tree', () => {
  const snapshot = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'snapshot.rs'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  assert.match(snapshot, /pub current_id: Option<u32>/);
  assert.match(app, /change\.current_id/);
  assert.match(app, /node_id: change\.current_id/);
});

test('UI exposes workspace context, source provenance, synchronized selection card and keyboard workspaces', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'renderer/styles.css'), 'utf8');
  assert.match(html, /id="viewContextTitle"/);
  assert.match(html, /id="summarySource"/);
  assert.match(html, /id="detailShareBar"/);
  assert.match(app, /const VIEW_CONTEXT = Object\.freeze/);
  assert.match(app, /\^\[1-7\]\$/);
  assert.match(app, /Saved scan/);
  assert.match(styles, /\.selection-card/);
  assert.match(styles, /\.view-context/);
});


test('treemap maximize pins the actual treemap panel and canvas to the full workspace', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'renderer/styles.css'), 'utf8');
  assert.match(styles, /\.workspace\s*\{[^}]*position:\s*relative/s);
  assert.match(styles, /\.workspace\.treemap-maximized \.treemap-panel\s*\{[^}]*position:\s*absolute[^}]*inset:\s*8px[^}]*grid-template-rows:\s*46px minmax\(0,\s*1fr\)/s);
  assert.match(styles, /\.workspace\.treemap-maximized \.treemap-wrap\s*\{[^}]*height:\s*100%/s);
  assert.match(styles, /\.workspace\.treemap-maximized #treemapCanvas\s*\{[^}]*height:\s*100%/s);
  assert.match(app, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => drawTreemap\(\)\)\)/);
});

test('extension/category highlighting is subtree-aware instead of leaving every directory bright', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  const mainRs = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'main.rs'), 'utf8');
  const model = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'model.rs'), 'utf8');
  assert.match(app, /filter_extensions:\s*currentTreemapFilterExtensions\(\)/);
  assert.match(app, /rect\.matches_filter/);
  assert.match(app, /group\.matches_filter === false/);
  assert.match(mainRs, /filter_extensions/);
  assert.match(model, /pub matches_filter: bool/);
  assert.match(model, /own_match \|\| child_match/);
  assert.match(model, /remainder_matches_filter/);
});

test('type-statistics header keeps Clear reachable in narrow panels', () => {
  const styles = fs.readFileSync(path.join(root, 'renderer/styles.css'), 'utf8');
  assert.match(styles, /\.extension-panel[^}]*container-type:\s*inline-size/s);
  assert.match(styles, /\.type-heading[^}]*flex-wrap:\s*wrap/s);
  assert.match(styles, /@container \(max-width:\s*390px\)/);
  assert.match(styles, /\.type-mode[^}]*flex-wrap:\s*wrap/s);
  assert.match(html, /id="clearExtensionFilter"[^>]*title="Clear all extension\/category highlights"/);
});


test('extension and category highlighting supports Ctrl+Click multi-selection with OR filtering', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  const mainRs = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'main.rs'), 'utf8');
  const model = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'model.rs'), 'utf8');
  assert.match(app, /activeExtensions:\s*\[\]/);
  assert.match(app, /activeCategories:\s*\[\]/);
  assert.match(app, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(app, /function updateTypeSelection\(/);
  assert.match(app, /const wanted = new Set\(state\.activeExtensions/);
  assert.match(app, /const categories = new Set\(state\.activeCategories\)/);
  assert.match(app, /filter_extensions:\s*currentTreemapFilterExtensions\(\)/);
  assert.match(mainRs, /filter_extensions/);
  assert.match(model, /let wanted: HashSet<String>/);
  assert.match(model, /wanted\.contains\(&node\.extension\)/);
  assert.match(html, /Ctrl\+Click to multi-select/);
});


test('retains persistent six-language localization with English default', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(root, 'renderer/i18n.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
  assert.match(html, /id="settingLanguage"/);
  for (const value of ['en','de','hu','fr','it','es']) assert.match(html, new RegExp(`option value="${value}"`));
  assert.match(app, /language:\s*'en'/);
  assert.match(app, /i18n\?\.setLanguage\(s\.language \|\| 'en'\)/);
  assert.match(app, /settingLanguage/);
  assert.match(i18n, /de:\s*\{ name: 'Deutsch'/);
  assert.match(i18n, /hu:\s*\{ name: 'Magyar'/);
  assert.match(i18n, /fr:\s*\{ name: 'Français'/);
  assert.match(i18n, /it:\s*\{ name: 'Italiano'/);
  assert.match(i18n, /es:\s*\{ name: 'Español'/);
  assert.match(preload, /setLanguage: language => ipcRenderer\.invoke\('ui:setLanguage'/);
  assert.match(main, /UI_LANGUAGES = new Set\(\['en','de','hu','fr','it','es'\]\)/);
});

test('incremental refresh reconciles subtrees in the authoritative Rust model', () => {
  const mainRs = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'main.rs'), 'utf8');
  const model = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'model.rs'), 'utf8');
  const scanner = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'scanner.rs'), 'utf8');
  assert.match(mainRs, /"refresh_selected"/);
  assert.match(mainRs, /"refresh_paths"/);
  assert.match(mainRs, /run_scan_quiet/);
  assert.match(mainRs, /reconcile_subtree/);
  assert.match(model, /pub fn reconcile_subtree/);
  assert.match(model, /relative_path/);
  assert.match(model, /pub active: bool/);
  assert.match(model, /reused_ids/);
  assert.match(model, /removed_ids/);
  assert.match(scanner, /pub fn run_scan_quiet/);
});

test('filesystem watching is optional, native-backed, debounced and overflow-aware', () => {
  const watcher = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'watcher.rs'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  assert.match(watcher, /RecommendedWatcher/);
  assert.match(watcher, /RecursiveMode::Recursive/);
  assert.match(watcher, /overflow_refresh_required/);
  assert.match(watcher, /Duration::from_millis/);
  assert.match(app, /watchFilesystem:\s*false/);
  assert.match(app, /cmd: 'watch_start'/);
  assert.match(app, /cmd: 'refresh_paths'/);
  assert.match(html, /id="settingWatchFilesystem"/);
  assert.match(html, /id="settingWatchDebounce"/);
  assert.match(html, /id="watchStatus"/);
});

test('local SQLite history uses schema versioning, transactions and parameterized statements', () => {
  const history = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'history.rs'), 'utf8');
  const mainRs = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'main.rs'), 'utf8');
  const electronMain = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
  assert.match(history, /SCHEMA_VERSION/);
  assert.match(history, /Connection::open/);
  assert.match(history, /transaction/);
  assert.match(history, /params!/);
  assert.match(history, /fingerprint_cache/);
  assert.match(history, /CREATE INDEX/);
  assert.match(history, /DISKMOSAIC_DATA_DIR/);
  assert.match(electronMain, /DISKMOSAIC_DATA_DIR:\s*app\.getPath\('userData'\)/);
  assert.match(mainRs, /history_store_current/);
  assert.match(mainRs, /history_load/);
  assert.match(mainRs, /history_delete/);
  assert.match(mainRs, /compare_history/);
  assert.match(html, /data-view="history"/);
});

test('duplicate finder adds BLAKE3 cache reuse while retaining exact verification', () => {
  const dupes = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'duplicates.rs'), 'utf8');
  assert.match(dupes, /blake3/);
  assert.match(dupes, /get_fingerprint/);
  assert.match(dupes, /put_fingerprint/);
  assert.match(dupes, /sample_hash/);
  assert.match(dupes, /full_hash/);
  assert.match(dupes, /files_equal/);
  assert.match(dupes, /recoverable_logical/);
  assert.match(dupes, /recoverable_allocated/);
});

test('supports bounded engine-owned multi-selection and safe batch actions', () => {
  const mainRs = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'main.rs'), 'utf8');
  const model = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'model.rs'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  assert.match(mainRs, /selection_replace/);
  assert.match(mainRs, /selection_toggle/);
  assert.match(mainRs, /selection_summary/);
  assert.match(mainRs, /batch_trash/);
  assert.match(mainRs, /hash_selection/);
  assert.match(model, /pub struct SelectionSummary/);
  assert.match(model, /normalized_selection/);
  assert.match(app, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(app, /event\.shiftKey/);
  assert.match(app, /Move selected items to Trash/);
  assert.match(app, /confirmDialog/);
});

test('rich metadata is fetched lazily for selected entries', () => {
  const metadata = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'metadata.rs'), 'utf8');
  const mainRs = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'main.rs'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  assert.match(mainRs, /"get_metadata"/);
  assert.match(metadata, /symlink_metadata/);
  assert.match(metadata, /inode/);
  assert.match(metadata, /uid/);
  assert.match(metadata, /file_attributes/);
  assert.match(app, /function loadRichMetadata/);
  assert.match(app, /cmd: 'get_metadata'/);
});

test('command palette and navigation history reuse local application actions', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  assert.match(html, /id="commandPaletteModal"/);
  assert.match(app, /commandPaletteCommands/);
  assert.match(app, /event\.ctrlKey && event\.shiftKey && event\.key\.toLowerCase\(\) === 'p'/);
  assert.match(app, /navigateBack/);
  assert.match(app, /navigateForward/);
  assert.match(app, /renderBreadcrumbs/);
  assert.match(html, /id="backButton"/);
  assert.match(html, /id="forwardButton"/);
  assert.match(html, /id="parentButton"/);
});

test('comparison exposes hierarchical deltas and a magnitude-based delta treemap', () => {
  const snapshot = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'snapshot.rs'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  assert.match(snapshot, /pub hierarchy:/);
  assert.match(snapshot, /files_added/);
  assert.match(snapshot, /files_removed/);
  assert.match(snapshot, /allocation_only/);
  assert.match(snapshot, /magnitude/);
  assert.match(app, /drawDeltaTreemap/);
  assert.match(app, /Math\.abs/);
  assert.match(html, /id="treemapModeButton"/);
});

test('settings exposes About opposite Save and the About dialog carries project identity', () => {
  const footerStart = html.indexOf('settings-footer');
  assert.ok(footerStart >= 0, 'settings footer missing');
  const footerEnd = html.indexOf('</footer>', footerStart);
  const footer = html.slice(footerStart, footerEnd);
  assert.ok(footer.indexOf('id="aboutButton"') >= 0, 'About button missing from settings footer');
  assert.ok(footer.indexOf('id="saveSettingsButton"') >= 0, 'Save button missing from settings footer');
  assert.ok(footer.indexOf('id="aboutButton"') < footer.indexOf('id="saveSettingsButton"'), 'About should be on the opposite/left side of Save');
  assert.match(html, /id="aboutModal"/);
  assert.match(html, /About DiskMosaic Light/);
  assert.match(html, /Version 1\.0\.0/);
  assert.match(html, /GNU AGPL v3 only/);
  assert.match(html, /Copyright \(c\) 2026 davoda1/);
  assert.match(html, /Cross-platform disk usage analyzer and filesystem investigation tool/);
});

test('visible feature strings are covered by all six language modes', () => {
  const i18n = fs.readFileSync(path.join(root, 'renderer/i18n.js'), 'utf8');
  for (const language of ['de', 'hu', 'fr', 'it', 'es']) assert.match(i18n, new RegExp(`\\n\\s*${language}: \\{`));
  for (const key of ['About DiskMosaic Light', 'History', 'Not watching', 'Command Palette', 'Copy paths', 'Directory tree columns', 'Incremental refresh completed']) {
    const count = (i18n.match(new RegExp(`'${key.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}'`, 'g')) || []).length;
    assert.ok(count >= 5, `expected translated coverage for ${key}, found ${count}`);
  }
});

test('comprehensive file-type table covers the supplied minimum extension list', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(root, 'renderer/file-types.js'), 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  const types = context.window.DiskMosaicFileTypes;
  assert.ok(types, 'file type registry did not initialize');
  assert.ok(types.recognizedExtensionCount >= 2000, `expected >=2000 normalized extension tokens, got ${types.recognizedExtensionCount}`);
  assert.equal(types.sourceExtensionCount, 240);

  const coverage = fs.readFileSync(path.resolve(root, '..', 'docs', 'FILE-TYPE-COVERAGE.txt'), 'utf8');
  const required = [...new Set((coverage.match(/(?:^|\s)(\.[^\s]+)/gm) || []).map(value => value.trim().toLowerCase()))];
  const missing = required.filter(extension => !types.descriptorForExtension(extension));
  assert.deepEqual(missing, [], `unrecognized required extensions: ${missing.join(', ')}`);

  const sourceSection = coverage.match(/SOURCE CODE \/ SCRIPTS[\s\S]*?={20,}\s*WEB/);
  assert.ok(sourceSection, 'source-code coverage section missing');
  const sourceExtensions = [...new Set((sourceSection[0].match(/(?:^|\s)(\.[^\s]+)/gm) || []).map(value => value.trim().toLowerCase()))];
  const genericSource = sourceExtensions.filter(extension => {
    const descriptor = types.descriptorForExtension(extension);
    return !descriptor || descriptor.key === 'code';
  });
  assert.deepEqual(genericSource, [], `source extensions without dedicated technology badges: ${genericSource.join(', ')}`);

  for (const [name, expectedKey] of [
    ['hello.rs','rust'], ['main.cpp','cpp'], ['app.ts','typescript'], ['widget.tsx','tsx'],
    ['script.py','python'], ['Main.java','java'], ['Program.cs','csharp'], ['shader.wgsl','wgsl'],
    ['Dockerfile','dockerfile'], ['Makefile','make'], ['CMakeLists.txt','cmake'],
    ['backup.tzst','archive'], ['template.blade.php','blade'],
  ]) {
    const descriptor = types.descriptorForNode({ name, extension: '', kind: 'file', type_hint: '' });
    assert.ok(descriptor, `${name} should resolve`);
    assert.equal(descriptor.key, expectedKey, `${name} resolved to ${descriptor.key} instead of ${expectedKey}`);
  }
});

test('extensionless local file classifier is bounded, magic-aware and shebang-aware', () => {
  const filetype = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'filetype.rs'), 'utf8');
  const scanner = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'scanner.rs'), 'utf8');
  const model = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'model.rs'), 'utf8');
  assert.match(filetype, /const PROBE_BYTES: usize = 4096/);
  assert.match(filetype, /type_hint_for_file/);
  assert.match(filetype, /starts_with\(b"\\x7fELF"\)/);
  assert.match(filetype, /shebang_hint/);
  assert.match(filetype, /PermissionsExt/);
  assert.doesNotMatch(filetype, /Command::new\(|std::process::Command/);
  assert.match(scanner, /type_hint_for_file\(&path, &metadata, &extension\)/);
  assert.match(model, /pub type_hint: String/);
});

test('settings units stay inline and About remains a child of Settings', () => {
  const styles = fs.readFileSync(path.join(root, 'renderer/styles.css'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  assert.match(html, /settingTreemapMinPx[^<]*[\s\S]*?unit-label">px/);
  assert.match(html, /settingTreemapCushionStrength[^<]*[\s\S]*?unit-label">%/);
  assert.match(styles, /\.input-with-unit\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  const openAbout = app.slice(app.indexOf('function openAbout()'), app.indexOf('function closeAbout()'));
  assert.doesNotMatch(openAbout, /settingsModal[^\n]*classList\.add\('hidden'\)/);
  assert.match(app, /if \(!\$\('settingsModal'\)\.classList\.contains\('hidden'\)\) \$\('aboutButton'\)\.focus\(\)/);
});

test('history schema persists file type hints and migrates v1 safely', () => {
  const history = fs.readFileSync(path.resolve(root, '..', 'engine', 'src', 'history.rs'), 'utf8');
  assert.match(history, /const SCHEMA_VERSION: i64 = 2/);
  assert.match(history, /type_hint TEXT NOT NULL DEFAULT ''/);
  assert.match(history, /ALTER TABLE nodes ADD COLUMN type_hint/);
  assert.match(history, /history_migrates_schema_v1_type_hints_without_losing_rows/);
});
