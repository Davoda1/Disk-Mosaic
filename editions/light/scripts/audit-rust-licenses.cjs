#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const [metadataPath, reportPath, licensesPath] = process.argv.slice(2);
if (!metadataPath || !reportPath || !licensesPath) {
  fail('Usage: audit-rust-licenses.cjs <cargo-metadata.json> <report.md> <licenses.txt>');
}

const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
if (!Array.isArray(metadata.packages) || metadata.packages.length === 0) {
  fail('Cargo metadata did not contain any packages.');
}

// Deliberately conservative allow-list. A future dependency with another SPDX identifier
// stops the release build so its obligations are reviewed explicitly rather than silently
// entering a distributable binary.
const allowedIds = new Set([
  '0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BSL-1.0',
  'CC0-1.0', 'ISC', 'MIT', 'MIT-0', 'Unlicense', 'Unicode-3.0',
  'Unicode-DFS-2016', 'Zlib', 'BlueOak-1.0.0', 'LLVM-exception'
]);
const operators = new Set(['AND', 'OR', 'WITH']);

function licenseIds(expression) {
  return expression
    .replace(/[()]/g, ' ')
    .replace(/\//g, ' OR ')
    .split(/\s+/)
    .map(v => v.trim())
    .filter(Boolean)
    .filter(v => !operators.has(v));
}

function markdownCell(value) {
  // Keep each dependency on one row. Character references preserve literal metadata
  // without introducing Markdown escapes, table delimiters, or inline HTML/formatting.
  return String(value)
    .replace(/\r\n|[\r\n\u2028\u2029]/g, ' ')
    .replace(/[\\|&<>`*_[\]~]/g, character => `&#${character.codePointAt(0)};`);
}

const packages = [...metadata.packages].sort((a, b) =>
  a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const failures = [];
for (const pkg of packages) {
  if (pkg.name === 'diskmosaic-engine' && !pkg.source) continue;
  if (!pkg.license) {
    failures.push(`${pkg.name} ${pkg.version}: no SPDX license expression in Cargo metadata`);
    continue;
  }
  const ids = licenseIds(pkg.license);
  const bad = ids.filter(id => !allowedIds.has(id));
  if (bad.length) {
    failures.push(`${pkg.name} ${pkg.version}: unreviewed SPDX identifier(s): ${bad.join(', ')} (expression: ${pkg.license})`);
  }
}

if (failures.length) {
  console.error('Rust dependency licensing audit FAILED. Review the following before release:');
  for (const item of failures) console.error(`  - ${item}`);
  process.exit(2);
}

const generated = new Date().toISOString();
const lines = [
  '# Resolved Rust dependency license audit',
  '',
  `Generated: ${generated}`,
  '',
  'This report is generated from `cargo metadata --locked --format-version 1` for the',
  'exact dependency graph resolved by the current DiskMosaic build. The build fails if a',
  'registry dependency omits its SPDX license metadata or introduces a license identifier',
  'outside DiskMosaic\'s reviewed permissive/public-domain allow-list.',
  '',
  '| Crate | Version | SPDX license expression | Source |',
  '| --- | --- | --- | --- |'
];
for (const pkg of packages) {
  if (pkg.name === 'diskmosaic-engine' && !pkg.source) continue;
  const cells = [pkg.name, pkg.version, pkg.license || '', pkg.source || 'local'];
  lines.push(`| ${cells.map(markdownCell).join(' | ')} |`);
}
lines.push('', `Audited packages: **${packages.filter(p => !(p.name === 'diskmosaic-engine' && !p.source)).length}**.`, '');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');

// Collect license/notice texts shipped inside the exact registry crate sources Cargo used.
// This supplements the SPDX table with upstream license text where the crate package carries it.
const out = [];
const seen = new Set();
for (const pkg of packages) {
  if (!pkg.source) continue;
  const dir = path.dirname(pkg.manifest_path);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { continue; }
  const candidates = names.filter(name => /^(LICENSE|LICENCE|COPYING|NOTICE|UNLICENSE)([._-].*)?$/i.test(name)).sort();
  if (!candidates.length) continue;
  out.push('='.repeat(78), `${pkg.name} ${pkg.version} — ${pkg.license || 'license-file'}`, '='.repeat(78), '');
  for (const name of candidates) {
    const file = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (!stat.isFile() || stat.size > 1024 * 1024) continue;
    const key = `${pkg.name}@${pkg.version}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`--- ${name} ---`, fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd(), '');
  }
}
fs.writeFileSync(licensesPath,
  `DiskMosaic 1.0.1 — Rust dependency license texts\nGenerated: ${generated}\n\n${out.join('\n')}\n`,
  'utf8');

console.log(`Rust dependency license audit PASS: ${packages.length - 1} resolved third-party packages.`);
console.log(`Audit report: ${reportPath}`);
console.log(`Collected license texts: ${licensesPath}`);
