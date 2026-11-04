'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'gui/package.json'), 'utf8'));
const hasLinuxPackaging = process.platform === 'linux' && ['cc', 'dpkg-deb', 'dpkg-parsechangelog'].every(command =>
  spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0);
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `${command}: ${result.stderr || result.stdout || result.error}`);
  return result;
}
function write(file, text, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode });
}
function compileEntry(output, destination) {
  run('cc', ['-Os', '-Wall', '-Wextra', '-Werror', `-DDISKMOSAIC_EXECUTABLE=${JSON.stringify(destination)}`,
    path.join(root, 'scripts/debian-entry.c'), '-o', output]);
}

test('native Debian entry forwards literal arguments and preserves target exit status', { skip: !hasLinuxPackaging }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diskmosaic-entry-'));
  try {
    const targetSource = path.join(tmp, 'target.c');
    const target = path.join(tmp, 'target with spaces');
    const entry = path.join(tmp, 'entry');
    write(targetSource, '#include <stdio.h>\n#include <string.h>\nint main(int n,char **v){for(int i=1;i<n;++i){fwrite(v[i],1,strlen(v[i]),stdout);putchar(0);}return 37;}\n');
    run('cc', [targetSource, '-o', target]);
    compileEntry(entry, target);
    const args = ['space in name', '$(touch should-not-exist)', 'semi;colon', 'quote"value', '--flag', 'line\nbreak'];
    const result = spawnSync(entry, args, { cwd: tmp });
    assert.equal(result.status, 37);
    assert.deepEqual(result.stdout, Buffer.from(`${args.join('\0')}\0`));
    assert.equal(fs.existsSync(path.join(tmp, 'should-not-exist')), false);
    assert.equal(fs.lstatSync(entry).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(entry).subarray(0, 4).toString('hex'), '7f454c46');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('native Debian entry reports missing and non-executable payloads', { skip: !hasLinuxPackaging }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diskmosaic-entry-failure-'));
  try {
    const entry = path.join(tmp, 'entry');
    const target = path.join(tmp, 'missing');
    compileEntry(entry, target);
    let result = spawnSync(entry, [], { encoding: 'utf8' });
    assert.equal(result.status, 127);
    assert.match(result.stderr, /Could not start DiskMosaic:/);
    write(target, 'not executable', 0o644);
    result = spawnSync(entry, [], { encoding: 'utf8' });
    assert.equal(result.status, 126);
    assert.match(result.stderr, /Could not start DiskMosaic:/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('Debian assembly produces a native /usr/bin entry and coinstallable payload', { skip: !hasLinuxPackaging }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diskmosaic-deb-'));
  try {
    const project = path.join(tmp, 'project');
    const stage = path.join(tmp, 'stage');
    const archive = path.join(tmp, 'fixture.deb');
    const extracted = path.join(tmp, 'extracted');
    write(path.join(project, 'gui/package.json'), JSON.stringify(metadata));
    fs.mkdirSync(path.join(project, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(root, 'scripts/debian-entry.c'), path.join(project, 'scripts/debian-entry.c'));
    for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'LICENSING-AUDIT.md']) write(path.join(project, name), `${name}\n`);
    for (const name of ['rust-license-audit.md', 'rust-third-party-licenses.txt']) write(path.join(project, 'dependencies', name), `${name}\n`);
    const product = metadata.build.productName;
    const name = metadata.name;
    write(path.join(stage, name), 'fixture application', 0o755);
    write(path.join(stage, 'chrome-sandbox'), 'fixture sandbox', 0o755);
    write(path.join(stage, 'resources/app.asar'), 'fixture asar');
    write(path.join(stage, 'resources/apparmor-profile'), `profile ${name} /opt/${product}/${name} { userns, }\n`);
    write(path.join(stage, 'resources/engine/diskmosaic-engine'), 'fixture engine', 0o755);
    write(path.join(project, 'gui/renderer/assets/icon.png'), 'fixture icon');
    run('bash', [path.join(root, 'scripts/_package_deb.sh'), project, stage, archive], {
      env: { ...process.env, NODE_BIN: process.execPath, TMPDIR: tmp }
    });
    run('dpkg-deb', ['-x', archive, extracted]);
    run('dpkg-deb', ['-e', archive, path.join(tmp, 'control')]);
    const entry = path.join(extracted, 'usr/bin', name);
    assert.equal(fs.lstatSync(entry).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(entry).subarray(0, 4).toString('hex'), '7f454c46');
    assert.ok(fs.readFileSync(entry).includes(Buffer.from(`/opt/${name}/${name}`)));
    assert.ok(fs.existsSync(path.join(extracted, 'opt', name, 'resources/app.asar')));
    assert.ok(fs.readFileSync(path.join(extracted, 'opt', name, 'resources/apparmor-profile'), 'utf8').includes(`/opt/${name}/${name}`));
    assert.equal(fs.existsSync(path.join(extracted, 'opt', product)), false);
    assert.equal(fs.statSync(path.join(extracted, 'opt', name, 'chrome-sandbox')).mode & 0o7777, 0o4755);
    for (const file of ['LICENSE', 'copyright', 'THIRD_PARTY_NOTICES.md', 'RUST_DEPENDENCIES.md', 'RUST_THIRD_PARTY_LICENSES.txt']) {
      assert.ok(fs.existsSync(path.join(extracted, 'usr/share/doc', name, file)), file);
    }
    assert.match(fs.readFileSync(path.join(extracted, 'usr/share/applications', `${name}.desktop`), 'utf8'), new RegExp(`Exec=/usr/bin/${name} %U`));
    assert.doesNotMatch(fs.readFileSync(path.join(tmp, 'control/postinst'), 'utf8'), /ln -s|sudo/);
    assert.equal(fs.existsSync(path.join(tmp, 'control/prerm')), false);
    const control = fs.readFileSync(path.join(tmp, 'control/control'), 'utf8');
    assert.match(control, /^Architecture: amd64$/m);
    assert.match(control, /^Depends: .*libnss3.*libx11-6/m);
    assert.match(control, /libasound2t64 \| libasound2/);
    assert.match(control, /^Recommends: libayatana-appindicator3-1 \| libappindicator3-1$/m);
    assert.equal(fs.readFileSync(path.join(extracted, 'usr/share/icons/hicolor/512x512/apps', `${name}.png`), 'utf8'), 'fixture icon');

  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('artifact checksum manifest is complete and never includes itself', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diskmosaic-checksums-'));
  try {
    write(path.join(tmp, 'a.zip'), 'alpha');
    write(path.join(tmp, 'b.tar.gz'), 'beta');
    const script = path.join(root, 'scripts/write-checksums.cjs');
    run(process.execPath, [script, tmp]);
    const expected = [['a.zip', 'alpha'], ['b.tar.gz', 'beta']]
      .map(([name, data]) => `${crypto.createHash('sha256').update(data).digest('hex')}  ${name}`).join('\n') + '\n';
    assert.equal(fs.readFileSync(path.join(tmp, 'SHA256SUM.txt'), 'utf8'), expected);
    run(process.execPath, [script, tmp]);
    assert.equal(fs.readFileSync(path.join(tmp, 'SHA256SUM.txt'), 'utf8'), expected);
    assert.deepEqual(fs.readdirSync(tmp).sort(), ['SHA256SUM.txt', 'a.zip', 'b.tar.gz']);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
