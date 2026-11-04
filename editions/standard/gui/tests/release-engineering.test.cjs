const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const sh = fs.readFileSync(path.join(root, 'scripts', '_common.sh'), 'utf8');
const ps = fs.readFileSync(path.join(root, 'scripts', '_common.ps1'), 'utf8');
const packageSh = fs.readFileSync(path.join(root, 'scripts', 'package.sh'), 'utf8');
const packagePs = fs.readFileSync(path.join(root, 'scripts', 'package.ps1'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'gui', 'package.json'), 'utf8'));

test('release Rust builds remap project/cache paths in disposable Cargo config on both platforms', () => {
  assert.match(sh, /\.cargo\/config\.toml/);
  assert.match(ps, /Join-Path \$RustEngineDir '\.cargo'/);
  assert.match(ps, /Join-Path \$cargoConfigDir 'config\.toml'/);
  for (const source of [sh, ps]) {
    assert.match(source, /--remap-path-prefix/);
    assert.match(source, /\/usr\/src\/diskmosaic/);
  }
  assert.match(sh, /check-binary-paths\.cjs/);
  assert.match(ps, /check-binary-paths\.cjs/);
});

test('exact Cargo license audit is a build and package gate', () => {
  const buildSh = fs.readFileSync(path.join(root, 'scripts', 'build.sh'), 'utf8');
  const buildPs = fs.readFileSync(path.join(root, 'scripts', 'build.ps1'), 'utf8');
  assert.match(sh, /cargo metadata --locked --format-version 1/);
  assert.match(ps, /cargo metadata --locked --format-version 1/);
  assert.match(buildSh, /audit_rust_licenses/);
  assert.match(buildPs, /Invoke-RustLicenseAudit/);
  assert.match(packageSh, /assert_release_audit/);
  assert.match(packagePs, /Assert-ReleaseAudit/);
});

test('license audit script accepts reviewed permissive metadata and rejects an unreviewed license', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diskmosaic-license-test-'));
  try {
    const script = path.join(root, 'scripts', 'audit-rust-licenses.cjs');
    const allowed = {
      packages: [
        { name: 'diskmosaic-engine', version: '1.0.0', source: null, license: 'AGPL-3.0-only', manifest_path: path.join(root, 'engine', 'Cargo.toml') },
        { name: 'allowed', version: '1.0.0', source: 'registry+https://github.com/rust-lang/crates.io-index', license: 'MIT OR Apache-2.0', manifest_path: path.join(tmp, 'missing', 'Cargo.toml') },
      ]
    };
    const metadata = path.join(tmp, 'allowed.json');
    fs.writeFileSync(metadata, JSON.stringify(allowed));
    let run = spawnSync(process.execPath, [script, metadata, path.join(tmp, 'report.md'), path.join(tmp, 'licenses.txt')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(fs.readFileSync(path.join(tmp, 'report.md'), 'utf8'), /allowed \| 1\.0\.0 \| MIT OR Apache-2\.0/);

    allowed.packages[1].license = 'GPL-3.0-only';
    fs.writeFileSync(metadata, JSON.stringify(allowed));
    run = spawnSync(process.execPath, [script, metadata, path.join(tmp, 'bad.md'), path.join(tmp, 'bad.txt')], { encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /unreviewed SPDX identifier/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('binary packages include project and resolved Rust licensing resources', () => {
  const tos = new Set(pkg.build.extraResources.map(item => item.to));
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'LICENSING-AUDIT.md', 'RUST_DEPENDENCIES.md', 'RUST_THIRD_PARTY_LICENSES.txt']) {
    assert.ok(tos.has(name), `missing extraResources destination ${name}`);
  }
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'LICENSING-AUDIT.md', 'RUST_DEPENDENCIES.md', 'RUST_THIRD_PARTY_LICENSES.txt']) {
    assert.match(packageSh, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(packagePs, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});


test('binary path checker detects forbidden UTF-8 and UTF-16LE build prefixes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diskmosaic-path-test-'));
  try {
    const script = path.join(root, 'scripts', 'check-binary-paths.cjs');
    const binary = path.join(tmp, 'engine.bin');
    fs.writeFileSync(binary, Buffer.concat([
      Buffer.from('prefix C:\\Users\\Builder\\DiskMosaic suffix\0', 'utf8'),
      Buffer.from('/safe/value', 'utf16le'),
    ]));
    let run = spawnSync(process.execPath, [script, binary, 'C:\\Users\\Builder\\DiskMosaic'], { encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Build-path privacy check FAILED/);
    run = spawnSync(process.execPath, [script, binary, '/not/present'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('release identity and exact dependency lock metadata agree', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'gui/package-lock.json'), 'utf8'));
  assert.equal(pkg.version, '1.0.1');
  assert.equal(pkg.license, 'AGPL-3.0-only');
  assert.equal(pkg.desktopName, `${pkg.name}.desktop`);
  assert.equal(pkg.build.linux.syncDesktopName, true);
  assert.equal(pkg.build.linux.executableName, pkg.name);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
  for (const version of Object.values(pkg.devDependencies)) assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.match(sh, /npm.*ci --no-audit --no-fund|NPM_BIN" ci --no-audit --no-fund/);
  assert.match(ps, /NpmBin ci --no-audit --no-fund/);
  assert.match(sh, /cp "\$ENGINE_DIR\/Cargo\.lock" "\$RUST_ENGINE_DIR\/Cargo\.lock"/);
  assert.match(ps, /Copy-Item -Force \$cargoLock/);
  for (const source of [sh, ps]) {
    assert.match(source, /cargo test --locked/);
    assert.match(source, /cargo build --locked/);
  }
});

test('packaging graph contains patched glob and minimatch versions', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'gui/package-lock.json'), 'utf8'));
  const atLeast = (actual, expected) => {
    const a = actual.split('.').map(Number);
    const b = expected.split('.').map(Number);
    for (let index = 0; index < 3; index++) {
      if (a[index] !== b[index]) return a[index] > b[index];
    }
    return true;
  };
  for (const [name, minimum] of [['minimatch', '11.0.1'], ['glob', '14.0.2']]) {
    const instances = Object.entries(lock.packages).filter(([location]) => location.endsWith(`/node_modules/${name}`) || location === `node_modules/${name}`);
    assert(instances.length > 0, `missing ${name} dependency`);
    for (const [location, value] of instances) assert(atLeast(value.version, minimum), `${location} is vulnerable: ${value.version}`);
  }
  assert.equal(pkg.engines.node, '>=26.13.0');
  assert.equal(pkg.devDependencies['electron-builder'], undefined);
});

test('ASAR packages nested and Unicode files and unpacks native modules with the patched matching APIs', async () => {
  const asar = await import('@electron/asar');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'diskmosaic-asar-'));
  try {
    const input = path.join(temporary, 'input');
    const output = path.join(temporary, 'app.asar');
    const fixtures = new Map([
      ['package.json', '{"name":"fixture","version":"1.0.0","main":"electron/main.cjs"}'],
      ['electron/main.cjs', 'module.exports = 42;'],
      ['renderer/nested folder/árvíz.txt', 'Unicode content ✓'],
      ['renderer/.hidden', 'dot file'],
      ['native/module.node', 'native module fixture'],
    ]);
    for (const [name, contents] of fixtures) {
      const file = path.join(input, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents);
    }
    await asar.createPackageWithOptions(input, output, { unpack: '**/*.node', dot: true });
    const files = asar.listPackage(output).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
    for (const [name, contents] of fixtures) {
      assert(files.includes(name), `missing archive entry: ${name}`);
      // ASAR resolves nested entries using the host path separator.
      assert.equal(asar.extractFile(output, path.normalize(name)).toString('utf8'), contents);
    }
    assert.equal(asar.statFile(output, path.join('native', 'module.node')).unpacked, true);
    assert.equal(fs.readFileSync(path.join(`${output}.unpacked`, 'native', 'module.node'), 'utf8'), 'native module fixture');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('package staging includes only application sources, platform engine, and required license resources', () => {
  const { stageApplication } = require('../../scripts/package-app.cjs');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'diskmosaic-stage-'));
  const fixture = path.join(temporary, 'project');
  const put = (name, value) => {
    const file = path.join(fixture, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };
  try {
    put('gui/package.json', JSON.stringify(pkg));
    put('gui/electron/main.cjs', 'module.exports = {};');
    put('gui/renderer/index.html', '<!doctype html><title>Fixture</title>');
    put('gui/tests/private-fixture.txt', 'excluded test fixture');
    put('gui/.env', 'excluded local settings');
    put('gui/node_modules/dependency/index.js', 'excluded build dependency');
    put('gui/resources/engine/diskmosaic-engine', 'Linux engine fixture');
    put('gui/resources/engine/diskmosaic-engine.exe', 'Windows engine fixture');
    for (const resource of pkg.build.extraResources.filter(value => value.to !== 'engine')) {
      put(path.join('gui', resource.from), `${resource.to}\n`);
    }
    for (const [platform, engine] of [['linux', 'diskmosaic-engine'], ['win32', 'diskmosaic-engine.exe']]) {
      const staged = stageApplication(fixture, path.join(temporary, platform), platform);
      assert.deepEqual(fs.readdirSync(staged.app).sort(), ['electron', 'package.json', 'renderer']);
      const manifest = JSON.parse(fs.readFileSync(path.join(staged.app, 'package.json'), 'utf8'));
      assert.equal(manifest.name, pkg.name);
      assert.equal(manifest.version, pkg.version);
      assert.equal(manifest.devDependencies, undefined);
      assert.equal(manifest.scripts, undefined);
      assert.equal(manifest.build, undefined);
      assert.deepEqual(fs.readdirSync(path.join(staged.resources, 'engine')), [engine]);
      assert.equal(fs.readFileSync(path.join(staged.resources, 'LICENSE'), 'utf8'), 'LICENSE\n');
    }
    if (process.platform !== 'win32') {
      fs.symlinkSync(path.join(fixture, 'gui/.env'), path.join(fixture, 'gui/renderer/leak'));
      assert.throws(() => stageApplication(fixture, path.join(temporary, 'symlink'), 'linux'), /must not be symbolic links/);
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
