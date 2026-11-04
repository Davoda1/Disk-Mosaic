#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const directory = process.argv[2];
if (!directory) throw new Error('Usage: write-checksums.cjs <artifact-directory>');
const files = fs.readdirSync(directory, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name !== 'SHA256SUM.txt')
  .map(entry => entry.name).sort();
if (!files.length) throw new Error('The artifact directory is empty.');
for (const name of files) {
  if (/[\r\n\\]/.test(name) || /\.sha256$/i.test(name)) throw new Error(`Unsupported artifact name: ${name}`);
}

async function main() {
  const lines = [];
  for (const name of files) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(path.join(directory, name))) hash.update(chunk);
    lines.push(`${hash.digest('hex')}  ${name}`);
  }
  fs.writeFileSync(path.join(directory, 'SHA256SUM.txt'), `${lines.join('\n')}\n`, 'utf8');
  console.log(`SHA256SUM.txt covers ${files.length} artifact(s).`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
