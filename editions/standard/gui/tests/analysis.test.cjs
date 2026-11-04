const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'gui', 'renderer', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'gui', 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'gui', 'renderer', 'styles.css'), 'utf8');
const treemapSource = fs.readFileSync(path.join(root, 'gui', 'renderer', 'treemap.js'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'engine', 'src', 'main.rs'), 'utf8');
const analysis = fs.readFileSync(path.join(root, 'engine', 'src', 'analysis.rs'), 'utf8');
const history = fs.readFileSync(path.join(root, 'engine', 'src', 'history.rs'), 'utf8');
const filetype = fs.readFileSync(path.join(root, 'engine', 'src', 'filetype.rs'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'gui', 'renderer', 'i18n.js'), 'utf8');

function loadTreemap() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(treemapSource, context, { filename: 'treemap.js' });
  return context.window.DiskMosaicTreemap;
}

function polygonInside(points, rect, eps = 1e-9) {
  return points.every(([x, y]) => x >= rect.x - eps && x <= rect.x + rect.w + eps && y >= rect.y - eps && y <= rect.y + rect.h + eps);
}

test('identity, IPC and history schema are internally aligned', () => {
  const cargo = fs.readFileSync(path.join(root, 'engine', 'Cargo.toml'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'gui', 'package.json'), 'utf8'));
  assert.match(cargo, /^version = "1\.0\.0"$/m);
  assert.equal(pkg.version, '1.0.0');
  assert.match(engine, /"engine_protocol":5/);
  assert.match(engine, /"protocol":5/);
  assert.match(history, /pub const SCHEMA_VERSION: i64 = 4/);
  assert.match(html, /Version 1\.0\.0/);
});

test('History Explorer is bounded, aggregated and reuses comparison', () => {
  assert.match(engine, /"history_timeline"/);
  assert.match(history, /scan_extensions/);
  assert.match(history, /scan_categories/);
  assert.match(history, /CREATE INDEX IF NOT EXISTS/);
  assert.match(app, /max_points:800/);
  assert.match(app, /historyBeforeSelect/);
  assert.match(app, /historyAfterSelect/);
  assert.match(app, /comparison_completed/);
  assert.doesNotMatch(app, /history.*nodes.*millions/i);
});

test('Age analysis includes explicit Unknown and click-through filtering', () => {
  for (const label of ['< 7 days','7–30 days','1–6 months','6–12 months','1–2 years','2–5 years','> 5 years','Unknown']) {
    assert.ok(analysis.includes(label), `missing age bucket ${label}`);
  }
  assert.match(analysis, /modified_ms\.is_none/);
  assert.match(app, /modified_unknown/);
  assert.match(app, /treemapColorMode.*age/s);
});

test('Advanced filtering is Rust-owned, supports AND and OR, and bounds results', () => {
  assert.match(analysis, /pub all: FilterSpec/);
  assert.match(analysis, /pub any: Vec<FilterSpec>/);
  assert.match(analysis, /query\.any\.iter\(\)\.any/);
  assert.match(analysis, /BinaryHeap/);
  assert.match(analysis, /limit\.clamp\(1, 5000\)/);
  for (const field of ['filename_contains','path_contains','extensions_any','categories_any','type_hints_any','min_logical','min_allocated','modified_before_ms','created_before_ms','min_age_days','sparse','compressed','min_hard_links','duplicate','owner_contains','permissions_contains','device','change_states_any']) {
    assert.ok(analysis.includes(field), `missing filter facet ${field}`);
  }
});

test('Smart Collections remain bounded virtual local views', () => {
  assert.match(app, /diskmosaic\.smartCollections/);
  assert.match(app, /slice\(0,200\)/);
  assert.match(app, /saveSmartCollection/);
  assert.match(app, /renameSmartCollection/);
  assert.match(app, /duplicateSmartCollection/);
  assert.match(app, /deleteSmartCollection/);
  assert.match(app, /never changes filesystem content/i);
  assert.match(app, /searchModifiedAfter.*filterDateValue/s);
});

test('Cleanup candidates are deterministic analysis and expose no delete engine command', () => {
  assert.match(analysis, /CleanupCandidate/);
  assert.match(analysis, /reason/);
  assert.match(analysis, /duplicate/i);
  assert.match(analysis, /sparse/i);
  assert.match(analysis, /BinaryHeap/);
  assert.match(app, /Cleanup Candidates/);
  assert.doesNotMatch(engine, /"cleanup_delete"|"cleanup_remove"|"permanent_delete"/);
});

test('Duplicate Finder 3.0 UI proposals do not bypass confirmed Trash', () => {
  for (const helper of ['Keep newest','Keep oldest','Keep shortest path','Keep selected path','Clear proposal']) assert.ok(app.includes(helper) || html.includes(helper));
  assert.match(app, /Proposed duplicate selection updated; nothing was deleted/);
  assert.match(app, /selectionAction\('trash'\)/);
  assert.match(app, /Review proposed Trash/);
});

test('Allocation Efficiency uses bounded engine selection and explicit metadata semantics', () => {
  assert.match(analysis, /allocation_analysis/);
  assert.match(analysis, /BinaryHeap/);
  assert.match(app, /allocation_analysis/);
  assert.match(app, /logical_size/);
  assert.match(app, /allocated_size/);
  assert.match(app, /ratio/);
});

test('treemap Auto depth preserves default hierarchy and labels use almost all tile width', () => {
  assert.match(app, /treemapDepth === 'auto'[\s\S]*?\? 3/);
  assert.doesNotMatch(app, /configuredTreemapLevels - 1/);
  assert.match(app, /const labelInset = 3/);
  assert.match(app, /const labelWidth = Math\.max\(0, w - labelInset \* 2\)/);
  assert.match(app, /availableTextWidth = Math\.max\(0, group\.w - 6\)/);
  assert.match(app, /primaryFontPx = w < 96 \? 10 : 11/);
  assert.match(html, /Auto preserves the established default hierarchy depth/);
});

test('Extruded treemap preserves authoritative layout area', () => {
  const t = loadTreemap();
  const items = [{ id: 1, size: 60 }, { id: 2, size: 30 }, { id: 3, size: 10 }];
  const rects = t.layout(items, 1000, 500);
  const totalArea = rects.reduce((n, r) => n + r.w * r.h, 0);
  assert.ok(Math.abs(totalArea - 500000) < 1e-5);
  const byId = new Map(rects.map(r => [r.id, r]));
  assert.ok(Math.abs((byId.get(1).w * byId.get(1).h) / totalArea - 0.60) < 1e-9);
  const before = JSON.stringify(rects.map(({id,x,y,w,h}) => ({id,x,y,w,h})));
  rects.forEach(r => t.extrusion(r, 85));
  const after = JSON.stringify(rects.map(({id,x,y,w,h}) => ({id,x,y,w,h})));
  assert.equal(after, before, 'decorative extrusion must not mutate data rectangles');
});

test('Extruded faces form a four-sided raised block clipped inside the authoritative rectangle', () => {
  const t = loadTreemap();
  const rect = { x: 5, y: 7, w: 80, h: 40 };
  const ex = t.extrusion(rect, 100);
  assert.equal(ex.degraded, false);
  assert.ok(ex.depth <= 18);
  for (const face of [ex.top, ex.right, ex.bottom, ex.left, ex.front]) {
    assert.ok(face.length >= 4);
    assert.ok(polygonInside(face, rect));
  }
  assert.deepEqual(ex.side, ex.right, 'legacy side alias must remain the right face');
  assert.ok(ex.front[0][0] > rect.x && ex.front[0][1] > rect.y, 'front face must be inset from top/left');
  assert.ok(ex.front[2][0] < rect.x + rect.w && ex.front[2][1] < rect.y + rect.h, 'front face must be inset from bottom/right');
  const microscopic = t.extrusion({ x: 1, y: 2, w: 3, h: 3 }, 100);
  assert.equal(microscopic.degraded, true);
  assert.equal(microscopic.depth, 0);
});

test('Treemap hit testing remains rectangle/node-ID based in 3D mode', () => {
  const t = loadTreemap();
  const rects = t.layout([{id:'large',size:3},{id:'small',size:1}],400,200);
  for (const rect of rects) {
    const hit = t.hitTest(rects, rect.x + rect.w / 2, rect.y + rect.h / 2);
    assert.equal(hit.id, rect.id);
  }
  assert.equal(t.hitTest(rects, -1, -1), null);
});

test('3D integration remains Canvas2D, bounded, resize/maximize/selection compatible', () => {
  assert.match(app, /treemapVisualization.*extruded3d/s);
  assert.match(app, /DiskMosaicTreemap\.extrusion/);
  assert.match(app, /ctx\.clip\(\)/);
  assert.match(app, /devicePixelRatio/);
  assert.match(app, /ResizeObserver/);
  assert.match(app, /treemapMaxItems/);
  assert.match(app, /ctrlKey|metaKey/);
  assert.match(app, /maximizeTreemap|treemap-maximized/);
  assert.doesNotMatch(app, /WebGL|three\.js|THREE\./);
});

test('tree/table UX keeps virtualization while adding desktop column controls', () => {
  for (const preset of ['compact','sizes','metadata','permissions','full']) assert.ok(app.includes(`'${preset}'`) || html.includes(`data-tree-preset="${preset}"`));
  assert.match(css, /position:\s*sticky/);
  assert.match(app, /dragstart/);
  assert.match(app, /dblclick/);
  assert.match(app, /contextmenu/);
  assert.match(app, /VirtualList|virtual/i);
});

test('selection inspector retains lazy rich metadata and multi-selection summaries', () => {
  assert.match(engine, /"metadata"/);
  assert.match(app, /rich metadata|metadata/i);
  assert.match(app, /items selected/);
  for (const label of ['Logical','Allocated','Permissions','Owner']) assert.ok(app.includes(label) || html.includes(label));
});

test('professional report is self-contained and exposes HTML JSON CSV Markdown', () => {
  const start = app.indexOf('function buildHtmlReport');
  const end = app.indexOf('async function exportProfessionalReport', start);
  const reportBuilder = app.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(reportBuilder, /<script[^>]+src=|<link[^>]+href=|https?:\/\//i);
  for (const heading of ['Filesystem information','Top directories','Largest files','Category distribution','Extension distribution','File age distribution','Duplicates','Allocation efficiency','Storage Insights','Issues','Comparison']) assert.ok(reportBuilder.includes(heading), `missing report section ${heading}`);
  assert.match(app, /format==='csv'/);
  assert.match(app, /format==='markdown'/);
  assert.match(app, /JSON\.stringify\(data/);
});

test('History maintenance is opt-in for automatic deletion and offers safe maintenance operations', () => {
  assert.match(app, /historyAutoRetention:\s*false/);
  assert.match(app, /historyRetentionMode:\s*'all'/);
  assert.match(html, /Keep all scans/);
  assert.match(html, /Keep last N scans per root/);
  assert.match(html, /Keep scans for N months/);
  assert.match(app, /history_integrity/);
  assert.match(app, /history_optimize/);
  assert.match(app, /history_backup/);
  assert.match(app, /history_prune_fingerprints/);
  assert.match(app, /window\.confirm/);
});

test('file-type registry and ambiguous probes remain bounded and local', () => {
  assert.match(html, /File Type Registry/);
  assert.match(app, /fileTypeOverrides/);
  assert.match(html, /Reset customizations/);
  assert.match(filetype, /const PROBE_BYTES: usize = 4096/);
  for (const ext of ['"ts"','"m"','"mod"','"bin"','"dat"','"raw"','"img"']) assert.ok(filetype.includes(ext));
  assert.match(filetype, /is_mpeg_transport_stream/);
  assert.match(filetype, /is_tracker_mod/);
  const runtimeFiletype = filetype.split('#[cfg(test)]')[0];
  assert.doesNotMatch(runtimeFiletype, /Command::new|std::process/);
});

test('hidden entries are always counted but presentation visibility is configurable by platform semantics', () => {
  assert.match(html, /id="settingHiddenDisplayMode"/);
  assert.match(html, /Show All/);
  assert.match(html, /Only Directories/);
  assert.match(html, /Hide All/);
  assert.match(app, /hiddenDisplayMode:\s*'show_all'/);
  assert.match(app, /hidden_mode:\s*hiddenDisplayMode\(\)/);
  assert.match(engine, /HiddenMode::parse/);
  assert.match(engine, /children_visible/);
  assert.match(engine, /largest_files_visible/);
  assert.match(engine, /treemap_visible/);
  assert.match(analysis, /hidden_mode:\s*HiddenMode/);
  const platform = fs.readFileSync(path.join(root, 'engine', 'src', 'platform.rs'), 'utf8');
  assert.match(platform, /FILE_ATTRIBUTE_HIDDEN/);
  assert.match(platform, /starts_with\('\.'\)/);
  assert.match(history, /SCHEMA_VERSION:\s*i64\s*=\s*4/);
  assert.match(history, /hidden INTEGER NOT NULL DEFAULT 0/);
  assert.match(i18n, /Hidden files and directories/);
});


test('settings use the available desktop width and symmetric action sizing', () => {
  assert.match(css, /\.settings-dialog\s*\{[^}]*width:\s*min\(1120px,/s);
  assert.match(css, /\.settings-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /fieldset\.settings-section-active\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.settings-grid \.button-row\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,/s);
  assert.match(css, /\.settings-grid \.button-row > \.button\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.settings-footer > \.button\s*\{[^}]*min-width:\s*112px/s);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*fieldset\.settings-section-active[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('Home, Settings, Diagnostics, Issues and session restoration are wired', () => {
  for (const section of ['general','appearance','scanning','tree','treemap','file-types','history','duplicates','accessibility','advanced']) assert.ok(html.includes(`data-settings-section="${section}"`) || html.includes(`data-settings-target="${section}"`));
  assert.match(html, /Recent/);
  assert.match(html, /Smart Collections/);
  assert.match(html, /Diagnostics/);
  assert.match(html, /Issues/);
  assert.match(app, /diskmosaic\.workspace/);
  assert.match(app, /restoreWorkspaceState/);
  assert.doesNotMatch(app, /resume.*destructive|resume.*trash/i);
});


test('home overlay symmetry, treemap settings persistence and special icons stay wired', () => {
  assert.match(html, /smart-collections-section/);
  assert.match(html, /start-action-history/);
  assert.match(css, /smart-collections-section/);
  assert.match(css, /start-action-history/);
  assert.match(html, /settingTreemapVisualization/);
  assert.doesNotMatch(html, /treemapVisualizationQuick/);
  assert.doesNotMatch(app, /treemapVisualizationQuick/);
  assert.match(app, /SPECIAL_DIRECTORY_ICONS/);
  assert.match(app, /shortcutDescriptorForExtension/);
  assert.match(app, /\.lnk/);
  assert.match(css, /folder-documents/);
  assert.match(css, /icon-shortcut/);
  assert.match(app, /ellipsizeCanvasText/);
  assert.match(css, /tree-name \.label \{ min-width: 0; flex: 1 1 auto;/);
});

test('Diagnostics are compact and do not serialize environment or current personal paths', () => {
  const start = engine.indexOf('fn emit_diagnostics');
  const slice = engine.slice(start, start + 2400);
  assert.match(slice, /CARGO_PKG_VERSION/);
  assert.match(slice, /history_schema/);
  assert.match(slice, /current_scan_nodes/);
  assert.doesNotMatch(slice, /std::env::vars|current_dir|root_path|username|home_dir/i);
});

test('synthetic treemap stress keeps 10k geometry as data objects rather than DOM nodes', () => {
  const t = loadTreemap();
  const items = Array.from({ length: 10_000 }, (_, i) => ({ id: i + 1, size: (i % 97) + 1 }));
  const rects = t.layout(items, 2560, 1440);
  assert.equal(rects.length, 10_000);
  assert.ok(rects.every(r => Number.isFinite(r.x) && Number.isFinite(r.y) && r.w >= 0 && r.h >= 0));
  assert.match(app, /treemapMaxItems: 2200/);
  assert.doesNotMatch(treemapSource, /document\.createElement|appendChild|innerHTML/);
});

test('UI remains six-language and offline Electron security remains unchanged', () => {
  for (const lang of ['de','hu','fr','it','es']) assert.ok(i18n.includes(`${lang}:`) || i18n.includes(`'${lang}'`), `missing ${lang} localization`);
  assert.match(i18n, /WORKSPACE_ROWS/);
  assert.match(i18n, /Extruded 3D Blocks/);
  const main = fs.readFileSync(path.join(root, 'gui', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /webSecurity:\s*true/);
  assert.match(main, /startsWith\('http:\/\/'\).*startsWith\('https:\/\/'\).*startsWith\('ws:\/\/'\).*startsWith\('wss:\/\/'\)/s);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
});


test('toolbar keeps the breadcrumb flexible at compact widths instead of collapsing left', () => {
  assert.match(css, /\.toolbar > \.path-bar \{[\s\S]*?flex:\s*1 1 180px/);
  assert.match(css, /@media \(max-width: 1160px\)[\s\S]*?\.toolbar > \.path-bar \{\s*flex:\s*1 1 140px/);
  assert.match(css, /\.toolbar \{[\s\S]*?width:\s*100%[\s\S]*?box-sizing:\s*border-box/);
});

test('source/build validation keeps high-detail failure diagnostics on Linux and Windows', () => {
  const commonSh = fs.readFileSync(path.join(root, 'scripts', '_common.sh'), 'utf8');
  const commonPs = fs.readFileSync(path.join(root, 'scripts', '_common.ps1'), 'utf8');
  const validateSh = fs.readFileSync(path.join(root, 'scripts', 'validate-source.sh'), 'utf8');
  const validatePs = fs.readFileSync(path.join(root, 'scripts', 'validate-source.ps1'), 'utf8');
  for (const source of [commonSh, commonPs]) {
    assert.match(source, /Node\/static diagnostic context/);
    assert.match(source, /test-reporter=spec/);
    assert.match(source, /Focused Node diagnostics/);
  }
  assert.match(commonSh, /RUST_BACKTRACE=1/);
  assert.match(commonSh, /--nocapture --test-threads=1/);
  assert.match(commonSh, /Focused Rust diagnostics/);
  assert.match(commonSh, /analysis::tests::/);
  assert.match(commonSh, /filetype::tests::/);
  assert.match(commonPs, /RUST_BACKTRACE/);
  assert.match(commonPs, /--nocapture/);
  assert.match(commonPs, /Focused Rust diagnostics/);
  assert.match(commonPs, /analysis::tests::/);
  assert.match(commonPs, /filetype::tests::/);
  for (const source of [validateSh, validatePs]) {
    assert.match(source, /Source validation PASS/);
    assert.match(source, /validate-metadata\.cjs/);
  }
});



test('Rust 1.98 analysis fixtures use explicit helper parameter types', () => {
  assert.match(analysis, /fn file_node\s*\([\s\S]*id:\s*NodeId[\s\S]*name:\s*&str[\s\S]*size:\s*u64[\s\S]*alloc:\s*u64[\s\S]*modified:\s*Option<u64>[\s\S]*ext:\s*&str[\s\S]*sparse:\s*Option<bool>[\s\S]*\)\s*->\s*Node/);
  assert.doesNotMatch(analysis, /let\s+file\s*=\s*\|id,name,size,alloc,modified,ext,sparse\|/);
});

test('model-heavy analyses are mutually exclusive with scans and other analyses', () => {
  const start = engine.indexOf('fn start_model_analysis');
  const slice = engine.slice(start, start + 3200);
  assert.match(slice, /state\.scanning\.load\(Ordering::Acquire\)/);
  assert.match(slice, /state\.analyzing\.swap\(true, Ordering::AcqRel\)/);
  assert.match(slice, /state\.analyzing\.store\(false, Ordering::Release\)/);
});

test('advanced-filter paging keeps a correct bounded top-K window', () => {
  assert.match(analysis, /let offset = query\.offset\.min\(15_000\)/);
  assert.match(analysis, /let retain = offset\.saturating_add\(limit\)/);
  assert.doesNotMatch(analysis, /retain = offset\.saturating_add\(limit\)\.min\(20_000\)/);
});


test('welcome/settings access, special folders, shortcuts and resize refresh are wired in the renderer', () => {
  assert.match(html, /id="overlaySettingsButton"/);
  assert.match(app, /overlaySettingsButton/);
  for (const token of ['cameraroll','savedpictures','dcim','templates','favorites','shareddocuments']) assert.match(app, new RegExp(token));
  assert.match(app, /\.appref-ms/);
  assert.match(app, /\.website/);
  assert.match(app, /\.alias/);
  assert.match(app, /window\.addEventListener\('resize', scheduleLayoutRefresh/);
  assert.match(app, /refreshVisibleDataViews/);
});


test('window state persistence stores normal bounds and validates restore coordinates', () => {
  const mainSource = fs.readFileSync(path.join(root, 'gui', 'electron', 'main.cjs'), 'utf8');
  assert.match(mainSource, /function normalizeWindowState/);
  assert.match(mainSource, /mainWindow\.getNormalBounds\(\)/);
  assert.match(mainSource, /mainWindow\.on\('resize', scheduleStateSave\)/);
  assert.match(mainSource, /mainWindow\.on\('move', scheduleStateSave\)/);
  assert.match(mainSource, /screen\.getAllDisplays/);
});

test('follow-up UI regression fixes keep settings populated and text layouts bounded', () => {
  assert.match(app, /fieldset\.classList\.toggle\('settings-section-active'/);
  assert.doesNotMatch(app, /settings-section-hidden/);
  assert.match(css, /\.settings-grid > fieldset\.settings-section-active \{[^}]*display: grid;[^}]*grid-template-columns:/s);
  assert.match(css, /\.smart-collections-section \{ grid-column: 1 \/ -1; width: 100%; justify-self: stretch; \}/);
  assert.match(css, /\.tree-grid, \.tree-row \{ grid-template-columns: var\(--tree-grid-template\) !important; width: 100%; min-width: 0; \}/);
  assert.match(app, /ellipsizeCanvasText/);
  assert.match(app, /const labelY = group\.y \+ group\.h - 22/);
  assert.match(treemapSource, /Math\.min\(18, Math\.min\(w, h\) \* 0\.24, 1\.5 \+ requested \* 0\.135\)/);
});

test('special local directories and link formats are case-insensitive and broad', () => {
  assert.match(app, /toLowerCase\(\)\.replace\(\/\[\\s\._-\]\+\/g/);
  for (const token of ['documents','downloads','pictures','cameraroll','screenshots','dcim','music','videos','desktop','favorites','links','contacts','savedgames','searches','3dobjects','templates','public','shareddocuments','onedrive','home','publicshare','trash','bin','usr','etc','var','opt','mnt','media','config','cache']) {
    assert.ok(app.includes(`${token}:`) || app.includes(`'${token}':`), `missing special directory token ${token}`);
  }
  for (const ext of ['.lnk','.url','.website','.appref-ms','.library-ms','.search-ms','.searchconnector-ms','.webloc','.alias','.desktop']) assert.ok(app.includes(ext), `missing shortcut/link format ${ext}`);
});


test('hidden-entry Node field is initialized in duplicate fixtures and Windows hidden detection is warning-clean', () => {
  const duplicates = fs.readFileSync(path.join(root, 'engine', 'src', 'duplicates.rs'), 'utf8');
  const platform = fs.readFileSync(path.join(root, 'engine', 'src', 'platform.rs'), 'utf8');
  assert.match(duplicates, /let make = \|id, name: &str, size\| Node \{[^}]*hidden:false/s);
  assert.match(platform, /#\[cfg\(windows\)\][\s\S]*?let _ = path;[\s\S]*?FILE_ATTRIBUTE_HIDDEN/);
});

test('responsive settings controls and active workspace tabs remain aligned at intermediate widths', () => {
  assert.match(app, /function ensureActiveTabVisible\(\)/);
  assert.match(app, /layoutWorkspaceTabs\(true\)/);
  assert.match(app, /strip\.scrollLeft = 0/);
  assert.match(app, /requestAnimationFrame\(ensureActiveTabVisible\)/);
  assert.match(css, /#settingsModal \{[\s\S]*?overflow: hidden;/);
  assert.match(css, /settings-grid label\.check input\[type="checkbox"\][\s\S]*?width: 16px !important;[\s\S]*?height: 16px !important;/);
  assert.match(css, /@media \(max-width: 1450px\)[\s\S]*?upper-pane[\s\S]*?66%/);
  assert.match(css, /@media \(max-width: 1280px\)[\s\S]*?upper-pane[\s\S]*?64%/);
  assert.match(css, /@media \(max-width: 1120px\)[\s\S]*?upper-pane[\s\S]*?61%/);
  assert.match(css, /settings-grid > fieldset\.settings-section-active[\s\S]*?repeat\(2, minmax\(240px, 1fr\)\)/);
});


test('intermediate DPI-scaled widths keep summary and watcher information visible', () => {
  assert.match(css, /@media \(max-width: 1180px\) and \(min-width: 901px\)/);
  assert.match(css, /\.watch-status \{ display: inline-flex; \}/);
  assert.match(css, /\.scan-summary-strip > \.summary-chip \{ display: grid; \}/);
  assert.match(css, /grid-template-columns: minmax\(0, 1\.68fr\) 5px minmax\(260px, 1fr\)/);
  assert.doesNotMatch(css.slice(css.lastIndexOf('final intermediate-width stabilization')), /minmax\(0, 6[1469]%\)/);
});

test('3D mode uses four-sided shaded raised blocks and never falls back to cushioned 2D', () => {
  const drawStart = app.indexOf('function drawExtrudedTile');
  const drawEnd = app.indexOf('function directoryColor', drawStart);
  const draw = app.slice(drawStart, drawEnd);
  assert.ok(drawStart >= 0 && drawEnd > drawStart);
  assert.doesNotMatch(draw, /drawCushionedTile\(/);
  for (const face of ['geometry.top', 'geometry.right', 'geometry.bottom', 'geometry.left', 'geometry.front']) assert.ok(draw.includes(face));
  assert.match(draw, /createLinearGradient/);
  assert.match(draw, /top\/left are brighter, right is darker, and bottom is darkest/);
  assert.match(app, /state\.settings\.treemapVisualization === 'extruded3d'\) \{/);
  assert.doesNotMatch(app, /treemapVisualization === 'extruded3d' && !tiny/);
  assert.match(treemapSource, /front, top, right, bottom, left/);
  assert.match(treemapSource, /Math\.min\(18, Math\.min\(w, h\) \* 0\.24, 1\.5 \+ requested \* 0\.135\)/);
});

test('filesystem watcher debounce supports long batching intervals without becoming a polling rescan', () => {
  const watcher = fs.readFileSync(path.join(root, 'engine', 'src', 'watcher.rs'), 'utf8');
  assert.match(html, /value="5000">5 seconds/);
  assert.match(html, /value="30000">30 seconds/);
  assert.match(html, /value="60000">1 minute/);
  assert.match(app, /watchDebounce: clamp\([^\n]+100, 60000\)/);
  assert.match(engine, /debounce_ms[\s\S]{0,180}clamp\(100, 60_000\)/);
  assert.match(watcher, /Duration::from_secs\(60\)/);
  assert.match(html, /does not periodically rescan the filesystem/i);
});

test('Linux root discovery never advertises regular-file mountpoints', () => {
  const platform = fs.readFileSync(path.join(root, 'engine', 'src', 'platform.rs'), 'utf8');
  assert.match(platform, /fn root_info_for_path/);
  assert.match(platform, /if !path\.is_dir\(\)/);
  assert.match(platform, /regular-file mountpoints must not be advertised as scan roots/);
});
