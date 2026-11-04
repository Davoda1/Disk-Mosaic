'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../../scripts/audit-rust-licenses.cjs');
const registry = 'registry+https://github.com/rust-lang/crates.io-index';

function audit(t, dependencies) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'diskmosaic-license-report-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const metadata = path.join(temporary, 'metadata.json');
  const report = path.join(temporary, 'report.md');
  const licenses = path.join(temporary, 'licenses.txt');
  const packages = [{
    name: 'diskmosaic-engine', version: '0.0.0', source: null, license: 'AGPL-3.0-only',
    manifest_path: path.join(temporary, 'project', 'Cargo.toml'),
  }, ...dependencies.map(dependency => ({
    name: 'reviewed-crate', version: '1.2.3', source: registry, license: 'MIT OR Apache-2.0',
    manifest_path: path.join(temporary, 'missing', 'Cargo.toml'), ...dependency,
  }))];
  fs.writeFileSync(metadata, JSON.stringify({ packages }));
  const result = spawnSync(process.execPath, [script, metadata, report, licenses], {
    encoding: 'utf8', timeout: 15000,
  });
  assert.ifError(result.error);
  return {
    ...result,
    report: fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : null,
    licenses: fs.existsSync(licenses) ? fs.readFileSync(licenses, 'utf8') : null,
  };
}

function tableRows(report) {
  const lines = report.split('\n');
  const start = lines.indexOf('| --- | --- | --- | --- |');
  assert.notEqual(start, -1, 'missing dependency table header');
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (!line) break;
    const parts = line.split('|');
    assert.equal(parts.length, 6, `expected exactly four table cells: ${line}`);
    assert.equal(parts[0], '');
    assert.equal(parts[5], '');
    rows.push(parts.slice(1, -1).map(cell => cell.trim()));
  }
  return rows;
}

function literalText(cell) {
  // Decode one layer, as a Markdown renderer does for character references.
  return cell.replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)));
}

test('license report preserves ordinary metadata and the local dependency fallback', t => {
  const result = audit(t, [{}, { name: 'local-crate', version: '0.4.0', license: 'BSD-3-Clause', source: null }]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(tableRows(result.report), [
    ['local-crate', '0.4.0', 'BSD-3-Clause', 'local'],
    ['reviewed-crate', '1.2.3', 'MIT OR Apache-2.0', registry],
  ]);
  assert.match(result.report, /Audited packages: \*\*2\*\*/);
  assert.doesNotMatch(result.report, /\| diskmosaic-engine \|/);
});

test('backslashes and pipes remain literal data inside four dependency table cells', t => {
  const values = ['plain|pipe', String.raw`one\|pipe`, String.raw`two\\|pipe`, String.raw`three\\\|pipe`, 'trailing\\'];
  const dependencies = values.map((value, index) => ({
    name: `fixture-${index}-${value}`, version: `1.2.3+${value}`, source: `git+https://example.invalid/${value}`,
  }));
  const result = audit(t, dependencies);
  assert.equal(result.status, 0, result.stderr);
  const rows = tableRows(result.report);
  assert.equal(rows.length, dependencies.length);
  rows.forEach((cells, index) => {
    const dependency = dependencies[index];
    assert.deepEqual(cells.map(literalText), [dependency.name, dependency.version, 'MIT OR Apache-2.0', dependency.source]);
    for (const cell of cells) assert.doesNotMatch(cell, /\\/, 'metadata must not add Markdown escape sequences');
  });
});

test('line breaks, HTML, Markdown, and pre-existing entities cannot change report structure', t => {
  const result = audit(t, [{
    name: '[label](https://example.invalid) *bold* _under_ `code` ~~strike~~ <img src=x>',
    version: '1.2.3\\|preview\r\n| injected | row | cells |',
    license: 'MIT\r\nOR Apache-2.0',
    source: 'git+https://example.invalid/&#124;?x=<b>&#10;\n# heading\rnext\u2028line\u2029end',
  }]);
  assert.equal(result.status, 0, result.stderr);
  const rows = tableRows(result.report);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].map(literalText), [
    '[label](https://example.invalid) *bold* _under_ `code` ~~strike~~ <img src=x>',
    '1.2.3\\|preview | injected | row | cells |',
    'MIT OR Apache-2.0',
    'git+https://example.invalid/&#124;?x=<b>&#10; # heading next line end',
  ]);
  for (const cell of rows[0]) {
    assert.doesNotMatch(cell, /[\\<>`*_[\]~]/, 'inline syntax must be represented as literal text');
    assert.doesNotMatch(cell, /&(?!#\d+;)/, 'input entities must not be interpreted as new characters');
  }
  assert.match(result.report, /Audited packages: \*\*1\*\*/);
});

test('missing and unreviewed licenses still fail before any report is written', t => {
  for (const license of [null, 'GPL-3.0-only', 'MIT OR <script>']) {
    const result = audit(t, [{ license }]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, license ? /unreviewed SPDX identifier/ : /no SPDX license expression/);
    assert.equal(result.report, null);
    assert.equal(result.licenses, null);
  }
});
