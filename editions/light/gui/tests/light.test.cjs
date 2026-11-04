const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'gui', 'renderer', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'gui', 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'gui', 'renderer', 'styles.css'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'gui', 'renderer', 'i18n.js'), 'utf8');
const treemapSource = fs.readFileSync(path.join(root, 'gui', 'renderer', 'treemap.js'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'engine', 'src', 'main.rs'), 'utf8');
const model = fs.readFileSync(path.join(root, 'engine', 'src', 'model.rs'), 'utf8');
const scanner = fs.readFileSync(path.join(root, 'engine', 'src', 'scanner.rs'), 'utf8');
const platform = fs.readFileSync(path.join(root, 'engine', 'src', 'platform.rs'), 'utf8');
const watcher = fs.readFileSync(path.join(root, 'engine', 'src', 'watcher.rs'), 'utf8');
const history = fs.readFileSync(path.join(root, 'engine', 'src', 'history.rs'), 'utf8');

function loadTreemap() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(treemapSource, context, { filename: 'treemap.js' });
  return context.window.DiskMosaicTreemap;
}

function polygonInside(points, rect, eps = 1e-9) {
  return points.every(([x, y]) => x >= rect.x - eps && x <= rect.x + rect.w + eps && y >= rect.y - eps && y <= rect.y + rect.h + eps);
}

test('Light 1.0.1 keeps the stable protocol and history schema', () => {
  const cargo = fs.readFileSync(path.join(root, 'engine', 'Cargo.toml'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'gui', 'package.json'), 'utf8'));
  assert.match(cargo, /^version = "1\.0\.1"$/m);
  assert.equal(pkg.version, '1.0.1');
  assert.match(engine, /"protocol":4,"version":env!\("CARGO_PKG_VERSION"\)/);
  assert.match(history, /const SCHEMA_VERSION: i64 = 2/);
  assert.match(html, /Version 1\.0\.1/);
});

test('report/About identity is 1.0.1 throughout the renderer', () => {
  assert.match(html, /Version 1\.0\.1/);
  assert.match(app, /application: \{ name: 'DiskMosaic Light', version: '1\.0\.1'/);
  assert.match(html, /<title>DiskMosaic Light<\/title>/);
  const versionTranslations = (i18n.match(/'Version 1\.0\.1'/g) || []).length;
  assert.ok(versionTranslations >= 5, `expected translated Version 1.0.1 coverage, found ${versionTranslations}`);
});

test('Light keeps the focused workspace set', () => {
  for (const view of ['age','cleanup','allocation','reports','issues','diagnostics']) {
    assert.doesNotMatch(html, new RegExp(`data-view=["']${view}["']`), `unexpected Standard workspace ${view}`);
  }
  assert.doesNotMatch(html, /Smart Collections/);
  assert.doesNotMatch(engine, /history_timeline|advanced_filter|cleanup_candidates|allocation_analysis|history_maintenance|diagnostics/);
  assert.match(html, /data-view="directory"/);
  assert.match(html, /data-view="history"/);
});

test('welcome screen exposes Settings before a scan', () => {
  assert.match(html, /id="overlaySettingsButton"/);
  assert.match(html, /start-settings-button/);
  assert.match(app, /overlaySettingsButton.*openSettings/s);
  assert.match(css, /\.start-settings-button\s*\{[^}]*left:\s*18px[^}]*bottom:\s*16px/s);
});

test('unsupported imported settings survive saves without enabling other workspaces', () => {
  assert.match(app, /const settings = \{ \.\.\.defaultSettings, \.\.\.raw \}/);
  assert.match(app, /const previous = state\.settings && typeof state\.settings === 'object' \? state\.settings : \{\}/);
  assert.match(app, /state\.settings = \{ \.\.\.defaultSettings, \.\.\.previous, \.\.\.settings \}/);
  assert.match(app, /saveSettings\(\{\s*\.\.\.state\.settings,/s);
  assert.match(app, /treeColumns:\s*\{[\s\S]*\.\.\.\(state\.settings\.treeColumns \|\| \{\}\)/s);
  assert.match(app, /dataset\.preserveUnsupported/);
  assert.match(app, /treemapColorMode:\s*\$\('settingTreemapColorMode'\)\.dataset\.preserveUnsupported \|\|/);

  // These preferences are unsupported by Light and preserved as unknown JSON
  // fields, not expose or implement them itself.
  const defaultsBlock = app.slice(app.indexOf('const defaultSettings'), app.indexOf('const DEFAULT_FILE_CATEGORIES'));
  for (const key of ['treeColumnOrder','treeColumnWidths','reducedMotion','highContrastFocus','alternatingRows','fileTypeOverrides','historyAutoRetention','historyRetentionMode','historyKeepLast','historyKeepMonths','settingsSection']) {
    assert.doesNotMatch(defaultsBlock, new RegExp(`\\b${key}\\b`), `unexpected unsupported setting implemented: ${key}`);
  }
  for (const control of ['settingReducedMotion','settingHighContrastFocus','settingAlternatingRows','settingFileTypeOverrides','settingHistoryRetentionMode']) {
    assert.doesNotMatch(html, new RegExp(`id=[\"']${control}[\"']`), `unexpected unsupported control implemented: ${control}`);
  }

  // Unknown nested tree-column fields must survive serialization without
  // being interpreted by the Light renderer.
  assert.match(app, /for \(const \[name, defaultVisible\] of Object\.entries\(defaultSettings\.treeColumns\)\)/);
  assert.doesNotMatch(app, /for \(const \[name, visible\] of Object\.entries\(columns\)\)/);
});

test('hidden entries are scan-accounted but display-filterable using platform-native semantics', () => {
  assert.match(model, /pub hidden: bool/);
  assert.match(model, /enum HiddenMode \{ ShowAll, DirectoriesOnly, HideAll \}/);
  assert.match(model, /visibility_mask/);
  assert.match(model, /hidden_display_modes_never_change_accounting_and_hide_expected_entries/);
  assert.match(model, /let \(_, show_all\) = model\.children_visible/);
  assert.match(model, /let \(_, directories_only\) = model\.children_visible/);
  assert.match(model, /let \(_, hide_all\) = model\.children_visible/);
  assert.match(scanner, /is_hidden_entry\(&path, &metadata\)/);
  assert.match(platform, /FILE_ATTRIBUTE_HIDDEN/);
  assert.match(platform, /starts_with\('\.'\)/);
  assert.match(html, /Show All/);
  assert.match(html, /Only Directories/);
  assert.match(html, /Hide All/);
  for (const command of ['children','largest','search','treemap']) {
    assert.match(app, new RegExp(`cmd: ['"]${command}['"][^}]*hidden_mode`, 's'), `renderer must send hidden_mode for ${command}`);
  }
  assert.match(history, /hidden:\s*false/);
  assert.match(history, /SCHEMA_VERSION: i64 = 2/);
});

test('watcher event batching offers up to one minute end to end', () => {
  for (const [value, label] of [['5000','5 seconds'],['30000','30 seconds'],['60000','1 minute']]) {
    assert.match(html, new RegExp(`<option value="${value}">${label}</option>`));
  }
  assert.match(html, /This does not periodically rescan the filesystem/);
  assert.ok(app.includes("watchDebounce: clamp(Number($('settingWatchDebounce').value) || 500, 100, 60000)"));
  assert.match(engine, /clamp\(100, 60_000\)/);
  assert.match(watcher, /Duration::from_secs\(60\)/);
});

test('special-folder and shortcut icons cover supported platforms', () => {
  assert.match(app, /SPECIAL_DIRECTORY_ICONS/);
  assert.match(app, /normalizedLocationToken/);
  assert.match(app, /toLowerCase\(\)/i);
  const tokens = [
    'documents','document','mydocuments','downloads','download','mydownloads',
    'pictures','picture','mypictures','gallery','galleries','photos','images','cameraroll','screenshots','savedpictures','dcim',
    'music','mymusic','audio','videos','video','myvideos','movies','desktop','favorites','favourites','links','contacts',
    'savedgames','searches','3dobjects','templates','startmenu','startup','programs','sendto','recent','public','publicdesktop',
    'publicdocuments','shareddocuments','publicdownloads','publicmusic','sharedmusic','publicpictures','sharedpictures','publicvideos',
    'sharedvideos','onedrive','iclouddrive','home','publicshare','trash','recyclebin','bin','sbin','usr','etc','var','opt','dev',
    'proc','sys','run','mnt','media','lostfound','config','cache','local'
  ];
  for (const token of tokens) assert.ok(app.toLowerCase().includes(token), `missing special location ${token}`);
  const shortcutExtensions = ['.lnk','.url','.webloc','.desktop','.appref-ms','.website','.alias','.library-ms','.search-ms','.searchconnector-ms'];
  for (const ext of shortcutExtensions) assert.ok(app.includes(ext), `missing shortcut mapping ${ext}`);
  for (const key of ['documents','downloads','pictures','music','videos','desktop','public','home','templates','favorites','links','contacts','games','searches','objects3d','system','cloud-local','trash','mount','config','cache','local']) {
    assert.ok(css.includes(`folder-${key}`), `missing special-folder CSS ${key}`);
  }
  assert.match(css, /file-icon\.directory\.special-folder/);
  assert.match(css, /file-icon\.file-type\.icon-shortcut/);
});

test('Extruded 3D is optional and does not mutate proportional treemap rectangles', () => {
  assert.match(app, /treemapVisualization:\s*'cushioned2d'/);
  assert.match(html, /Extruded 3D Blocks/);
  assert.match(app, /treemapVisualization === 'extruded3d'/);
  const t = loadTreemap();
  const items = [{ id: 1, size: 60 }, { id: 2, size: 30 }, { id: 3, size: 10 }];
  const rects = t.layout(items, 1000, 500);
  const area = rects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
  assert.ok(Math.abs(area - 500000) < 1e-5);
  const before = JSON.stringify(rects.map(({id,x,y,w,h}) => ({id,x,y,w,h})));
  rects.forEach(rect => t.extrusion(rect, 65));
  const after = JSON.stringify(rects.map(({id,x,y,w,h}) => ({id,x,y,w,h})));
  assert.equal(after, before);
});

test('3D extrusion stays bounded and hit testing remains rectangle based', () => {
  const t = loadTreemap();
  const rect = { x: 10, y: 20, w: 120, h: 60 };
  const ex = t.extrusion(rect, 100);
  assert.ok(ex.depth > 0 && ex.depth <= 18);
  assert.ok(polygonInside(ex.top, rect));
  for (const face of [ex.top, ex.right, ex.bottom, ex.left, ex.front]) assert.ok(polygonInside(face, rect));
  const tiny = t.extrusion({ x: 0, y: 0, w: 8, h: 8 }, 100);
  assert.equal(tiny.degraded, false);
  assert.ok([tiny.top, tiny.right, tiny.bottom, tiny.left, tiny.front].every(face => face.length === 4));
  const microscopic = t.extrusion({ x: 0, y: 0, w: 2, h: 2 }, 100);
  assert.equal(microscopic.degraded, true);
  const rects = t.layout([{ id: 'a', size: 3 }, { id: 'b', size: 1 }], 400, 200);
  for (const r of rects) assert.equal(t.hitTest(rects, r.x + r.w / 2, r.y + r.h / 2).id, r.id);
});

test('responsive layout keeps full-width toolbar and continuous fractional pane tracks', () => {
  assert.match(css, /\.toolbar\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%/s);
  assert.match(css, /\.toolbar > \.path-bar\s*\{[^}]*flex:\s*1 1 180px/s);
  assert.match(css, /@media \(max-width: 1450px\)[\s\S]*1\.95fr/);
  assert.match(css, /@media \(max-width: 1180px\) and \(min-width: 901px\)[\s\S]*1\.68fr/);
  assert.match(css, /@media \(max-width: 1040px\) and \(min-width: 901px\)[\s\S]*1\.55fr/);
  assert.match(css, /\.tree-name \.label\s*\{[^}]*text-overflow:\s*ellipsis/s);
  assert.match(css, /\.settings-grid\s*\{[^}]*repeat\(2, minmax\(300px, 1fr\)\)/s);
  assert.match(css, /\.settings-column\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*12px/s);
  assert.match(css, /\.settings-grid fieldset\s*\{[^}]*margin:\s*0/s);
  assert.match(app, /function balanceSettingsColumns\(\)/);
  assert.match(app, /const score = Math\.abs\(leftHeight - rightHeight\)/);
  assert.match(app, /scheduleSettingsColumnBalance\(\)/);
  assert.match(css, /label\.check input\[type="checkbox"\][\s\S]*width:\s*16px/);
});

test('3D renderer uses four shaded extrusion faces around an inset front', () => {
  assert.match(treemapSource, /Four-sided raised-block presentation geometry/);
  const t = loadTreemap();
  const ex = t.extrusion({ x: 10, y: 20, w: 120, h: 60 }, 65);
  assert.equal(ex.degraded, false);
  assert.equal(ex.front[0][0], 10 + ex.depth);
  assert.equal(ex.front[0][1], 20 + ex.depth);
  assert.equal(ex.front[2][0], 130 - ex.depth);
  assert.equal(ex.front[2][1], 80 - ex.depth);
  for (const name of ['top','right','bottom','left']) assert.equal(ex[name].length, 4, `${name} extrusion face missing`);
  assert.match(app, /Four surrounding trapezoid faces/);
  assert.match(app, /top\/left are brighter, right is darker, and bottom is darkest/);
  assert.match(app, /geometry\.top, geometry\.right, geometry\.bottom, geometry\.left, geometry\.front/);
  assert.match(app, /topShade\.addColorStop\(0, 'rgba\(255,255,255,\.56\)'\)/);
  assert.match(app, /rightShade\.addColorStop\(1, 'rgba\(0,0,0,\.58\)'\)/);
  assert.match(app, /bottomShade\.addColorStop\(1, 'rgba\(0,0,0,\.66\)'\)/);
});

test('visible display settings are translated in all six languages', () => {
  assert.match(i18n, /const DISPLAY_STRINGS/);
  for (const lang of ['de','hu','fr','it','es']) assert.match(i18n, new RegExp(`${lang}:\\s*\\{`));
  for (const source of ['Hidden files and directories','Show All','Only Directories','Hide All','5 seconds','30 seconds','1 minute','Visualization','Cushioned 2D','Extruded 3D Blocks','Extrusion depth','Version 1.0.1']) {
    const occurrences = i18n.split(`'${source}'`).length - 1;
    assert.ok(occurrences >= 5, `${source} should have translations for every non-English language`);
  }
});

test('Light retains the isolated offline renderer', () => {
  const main = fs.readFileSync(path.join(root, 'gui', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /webSecurity:\s*true/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(app, /fetch\(|WebSocket\(|XMLHttpRequest/);
});
