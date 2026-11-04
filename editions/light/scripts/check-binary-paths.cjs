#!/usr/bin/env node
'use strict';
const fs = require('node:fs');

function fail(message) { console.error(`ERROR: ${message}`); process.exit(1); }
const [binary, ...prefixes] = process.argv.slice(2);
if (!binary || prefixes.length === 0) fail('Usage: check-binary-paths.cjs <binary> <forbidden-prefix>...');
const data = fs.readFileSync(binary);
const variants = new Set();
for (const raw of prefixes) {
  if (!raw) continue;
  variants.add(raw);
  variants.add(raw.replace(/\\/g, '/'));
  variants.add(raw.replace(/\//g, '\\'));
}
const hits = [];
for (const value of variants) {
  const utf8 = Buffer.from(value, 'utf8');
  const utf16 = Buffer.from(value, 'utf16le');
  if (utf8.length && data.indexOf(utf8) >= 0) hits.push(`${value} (UTF-8)`);
  if (utf16.length && data.indexOf(utf16) >= 0) hits.push(`${value} (UTF-16LE)`);
}
if (hits.length) {
  console.error('Build-path privacy check FAILED. Absolute build prefix found in release engine:');
  for (const hit of [...new Set(hits)]) console.error(`  - ${hit}`);
  process.exit(2);
}
console.log(`Build-path privacy check PASS: ${binary}`);
